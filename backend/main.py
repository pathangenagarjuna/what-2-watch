
import os
import sqlite3
from pathlib import Path
from contextlib import asynccontextmanager
import jwt
from datetime import datetime, timedelta, timezone

from pwdlib import PasswordHash
from fastapi import Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from typing import Literal
BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
DB_PATH = BASE_DIR / "what2watch.db"

load_dotenv(Path(__file__).parent / ".env")
TMDB_API_KEY = os.getenv("TMDB_API_KEY")
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY")
ALGORITHM = "HS256"
TOKEN_EXPIRE_MINUTES = 60 * 24

password_hash = PasswordHash.recommended()
bearer_scheme = HTTPBearer(auto_error=False)


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=30)
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=1, max_length=128)

def get_db():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def create_access_token(user_id: int, role: str):
    if not JWT_SECRET_KEY:
        raise HTTPException(500, "JWT_SECRET_KEY is not configured.")

    expires = datetime.now(timezone.utc) + timedelta(
        minutes=TOKEN_EXPIRE_MINUTES
    )

    return jwt.encode(
        {
            "sub": str(user_id),
            "role": role,
            "exp": expires,
        },
        JWT_SECRET_KEY,
        algorithm=ALGORITHM,
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
):
    if credentials is None or not JWT_SECRET_KEY:
        raise HTTPException(401, "Please log in.")

    try:
        payload = jwt.decode(
            credentials.credentials,
            JWT_SECRET_KEY,
            algorithms=[ALGORITHM],
        )
        user_id = int(payload["sub"])
    except (jwt.InvalidTokenError, KeyError, ValueError):
        raise HTTPException(401, "Invalid or expired login token.")

    with get_db() as db:
        user = db.execute(
            "SELECT id, username, email, role FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()

    if user is None:
        raise HTTPException(401, "User account not found.")

    return dict(user)


def init_db():
    with get_db() as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user'
                    CHECK(role IN ('user', 'admin')),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Existing shared admin watchlist stays unchanged.
        db.execute("""
            CREATE TABLE IF NOT EXISTS admin_watchlist (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tmdb_id INTEGER NOT NULL UNIQUE,
                title TEXT NOT NULL,
                poster_path TEXT,
                release_date TEXT,
                vote_average REAL DEFAULT 0,
                position INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Each account has its own movies.
        db.execute("""
            CREATE TABLE IF NOT EXISTS user_movies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                tmdb_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                poster_path TEXT,
                release_date TEXT,
                vote_average REAL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'watchlist'
                    CHECK(status IN ('watchlist', 'completed')),
                position INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, tmdb_id),
                FOREIGN KEY (user_id) REFERENCES users(id)
                    ON DELETE CASCADE
            )
        """)

        # Reviews belong to a movie owned by that account.
        db.execute("""
            CREATE TABLE IF NOT EXISTS user_reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                movie_id INTEGER NOT NULL,
                rating INTEGER NOT NULL DEFAULT 0
                    CHECK(rating BETWEEN 0 AND 5),
                reaction TEXT NOT NULL DEFAULT '',
                review_text TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, movie_id),
                FOREIGN KEY (user_id) REFERENCES users(id)
                    ON DELETE CASCADE,
                FOREIGN KEY (movie_id) REFERENCES user_movies(id)
                    ON DELETE CASCADE
            )
        """)

        db.execute("""
            CREATE TABLE IF NOT EXISTS app_migrations (
                name TEXT PRIMARY KEY,
                completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Provision the admin from local environment variables.
        admin_username = os.getenv("ADMIN_USERNAME", "").strip()
        admin_email = os.getenv("ADMIN_EMAIL", "").strip().lower()
        admin_password = os.getenv("ADMIN_PASSWORD", "")

        if admin_username and admin_email and admin_password:
            existing = db.execute(
                "SELECT id, role FROM users WHERE email = ?",
                (admin_email,),
            ).fetchone()

            if existing is None:
                db.execute(
                    """
                    INSERT INTO users
                        (username, email, password_hash, role)
                    VALUES (?, ?, ?, 'admin')
                    """,
                    (
                        admin_username,
                        admin_email,
                        password_hash.hash(admin_password),
                    ),
                )
            elif existing["role"] != "admin":
                # Never silently promote an existing regular account.
                raise RuntimeError(
                    "ADMIN_EMAIL belongs to a non-admin account. "
                    "Use a different admin email in backend/.env."
                )
        else:
            print(
                "Admin account not provisioned: set ADMIN_USERNAME, "
                "ADMIN_EMAIL and ADMIN_PASSWORD in backend/.env."
            )


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="What 2 Watch API", lifespan=lifespan)


class MovieCreate(BaseModel):
    tmdb_id: int = Field(gt=0)
    title: str = Field(min_length=1, max_length=300)
    poster_path: str | None = None
    release_date: str | None = None
    vote_average: float = Field(default=0, ge=0, le=10)


class MovieStatusUpdate(BaseModel):
    status: str


class MovieOrderUpdate(BaseModel):
    movie_ids: list[int]


class ReviewUpdate(BaseModel):
    rating: int = Field(ge=1, le=5)
    reaction: Literal[
        "Loved it",
        "Amazing",
        "Average",
        "Disappointed"
    ]
    review_text: str = Field(default="", max_length=3000)

def movie_dict(row):
    return dict(row)

@app.post("/api/auth/register", status_code=201)
def register_user(request: RegisterRequest):
    username = request.username.strip()
    email = request.email.strip().lower()

    if not username or not email:
        raise HTTPException(400, "Username and email are required.")

    if "@" not in email or "." not in email.rsplit("@", 1)[-1]:
        raise HTTPException(400, "Enter a valid email address.")

    if not JWT_SECRET_KEY:
        raise HTTPException(500, "JWT_SECRET_KEY is not configured.")

    hashed_password = password_hash.hash(request.password)

    try:
        with get_db() as db:
            cursor = db.execute(
                """
                INSERT INTO users (username, email, password_hash)
                VALUES (?, ?, ?)
                """,
                (username, email, hashed_password),
            )
            user_id = cursor.lastrowid
    except sqlite3.IntegrityError:
        raise HTTPException(409, "Username or email already exists.")

    token = create_access_token(user_id, "user")

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user_id,
            "username": username,
            "email": email,
            "role": "user",
        },
    }


@app.post("/api/auth/login")
def login_user(request: LoginRequest):
    email = request.email.strip().lower()

    with get_db() as db:
        user = db.execute(
            "SELECT * FROM users WHERE email = ?",
            (email,),
        ).fetchone()

    if user is None or not password_hash.verify(
        request.password, user["password_hash"]
    ):
        raise HTTPException(401, "Incorrect email or password.")

    token = create_access_token(user["id"], user["role"])

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user["id"],
            "username": user["username"],
            "email": user["email"],
            "role": user["role"],
        },
    }


@app.get("/api/auth/me")
def get_my_profile(user: dict = Depends(get_current_user)):
    return user


@app.get("/api/health")
def health():
    return {"status": "running", "app": "What 2 Watch"}


@app.get("/api/search")
async def search_movies(query: str = Query(min_length=1, max_length=100)):
    if not TMDB_API_KEY:
        raise HTTPException(500, "TMDB_API_KEY is missing from backend/.env")

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(
                "https://api.themoviedb.org/3/search/movie",
                params={
                    "api_key": TMDB_API_KEY,
                    "query": query,
                    "include_adult": "false",
                },
            )
            response.raise_for_status()
            data = response.json()

        return {
            "results": [
                {
                    "id": m["id"],
                    "title": m.get("title", "Untitled"),
                    "overview": m.get("overview", ""),
                    "release_date": m.get("release_date", ""),
                    "poster_path": m.get("poster_path"),
                    "vote_average": m.get("vote_average", 0),
                }
                for m in data.get("results", [])
            ]
        }
    except httpx.HTTPStatusError as exc:
        raise HTTPException(502, "TMDB rejected the request. Check your API key.") from exc
    except httpx.RequestError as exc:
        raise HTTPException(502, "Could not connect to TMDB.") from exc



@app.get("/api/movies")
def get_movies(
    status: str = Query("watchlist", pattern="^(watchlist|completed)$"),
    user: dict = Depends(get_current_user),
):
    with get_db() as db:
        rows = db.execute(
            """
            SELECT m.*,
                   r.rating AS review_rating,
                   r.reaction AS review_reaction,
                   r.review_text,
                   r.updated_at AS review_updated_at
            FROM user_movies m
            LEFT JOIN user_reviews r
              ON r.movie_id = m.id AND r.user_id = m.user_id
            WHERE m.user_id = ? AND m.status = ?
            ORDER BY m.position, m.id
            """,
            (user["id"], status),
        ).fetchall()

    return {"results": [dict(row) for row in rows]}


@app.post("/api/movies", status_code=201)
def add_movie(
    movie: MovieCreate,
    user: dict = Depends(get_current_user),
):
    with get_db() as db:
        existing = db.execute(
            "SELECT id FROM user_movies WHERE user_id = ? AND tmdb_id = ?",
            (user["id"], movie.tmdb_id),
        ).fetchone()

        if existing:
            raise HTTPException(409, "This movie is already in your list.")

        position = db.execute(
            """
            SELECT COALESCE(MAX(position), -1) + 1
            FROM user_movies
            WHERE user_id = ? AND status = 'watchlist'
            """,
            (user["id"],),
        ).fetchone()[0]

        cursor = db.execute(
            """
            INSERT INTO user_movies
                (user_id, tmdb_id, title, poster_path, release_date,
                 vote_average, position)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user["id"], movie.tmdb_id, movie.title, movie.poster_path,
                movie.release_date, movie.vote_average, position,
            ),
        )
        row = db.execute(
            "SELECT * FROM user_movies WHERE id = ? AND user_id = ?",
            (cursor.lastrowid, user["id"]),
        ).fetchone()

    return dict(row)


@app.patch("/api/movies/{movie_id}")
def update_movie_status(
    movie_id: int,
    update: MovieStatusUpdate,
    user: dict = Depends(get_current_user),
):
    if update.status not in ("watchlist", "completed"):
        raise HTTPException(400, "Status must be watchlist or completed.")

    with get_db() as db:
        row = db.execute(
            "SELECT id FROM user_movies WHERE id = ? AND user_id = ?",
            (movie_id, user["id"]),
        ).fetchone()

        if row is None:
            raise HTTPException(404, "Movie not found.")

        position = db.execute(
            """
            SELECT COALESCE(MAX(position), -1) + 1
            FROM user_movies WHERE user_id = ? AND status = ?
            """,
            (user["id"], update.status),
        ).fetchone()[0]

        db.execute(
            """
            UPDATE user_movies SET status = ?, position = ?
            WHERE id = ? AND user_id = ?
            """,
            (update.status, position, movie_id, user["id"]),
        )
        updated = db.execute(
            "SELECT * FROM user_movies WHERE id = ? AND user_id = ?",
            (movie_id, user["id"]),
        ).fetchone()

    return dict(updated)


@app.put("/api/movies/reorder")
def reorder_movies(
    update: MovieOrderUpdate,
    user: dict = Depends(get_current_user),
):
    with get_db() as db:
        rows = db.execute(
            """
            SELECT id FROM user_movies
            WHERE user_id = ? AND status = 'watchlist'
            """,
            (user["id"],),
        ).fetchall()

        existing_ids = {row["id"] for row in rows}

        if (
            len(update.movie_ids) != len(set(update.movie_ids))
            or set(update.movie_ids) != existing_ids
        ):
            raise HTTPException(
                400, "Provide every watchlist movie ID exactly once."
            )

        db.executemany(
            "UPDATE user_movies SET position = ? WHERE id = ? AND user_id = ?",
            [
                (position, movie_id, user["id"])
                for position, movie_id in enumerate(update.movie_ids)
            ],
        )

    return {"message": "Watchlist order saved."}


@app.delete("/api/movies/{movie_id}")
def delete_movie(
    movie_id: int,
    user: dict = Depends(get_current_user),
):
    with get_db() as db:
        cursor = db.execute(
            "DELETE FROM user_movies WHERE id = ? AND user_id = ?",
            (movie_id, user["id"]),
        )
        if cursor.rowcount == 0:
            raise HTTPException(404, "Movie not found.")

    return {"message": "Movie removed successfully."}


@app.get("/api/movies/{movie_id}/review")
def get_review(
    movie_id: int,
    user: dict = Depends(get_current_user),
):
    with get_db() as db:
        movie = db.execute(
            "SELECT id FROM user_movies WHERE id = ? AND user_id = ?",
            (movie_id, user["id"]),
        ).fetchone()

        if movie is None:
            raise HTTPException(404, "Movie not found.")

        row = db.execute(
            """
            SELECT rating, reaction, review_text, updated_at
            FROM user_reviews
            WHERE movie_id = ? AND user_id = ?
            """,
            (movie_id, user["id"]),
        ).fetchone()

    if row is None:
        return {
            "rating": 0,
            "reaction": "",
            "review_text": "",
            "updated_at": None,
        }

    return dict(row)


@app.put("/api/movies/{movie_id}/review")
def save_review(
    movie_id: int,
    review: ReviewUpdate,
    user: dict = Depends(get_current_user),
):
    with get_db() as db:
        movie = db.execute(
            """
            SELECT id, status FROM user_movies
            WHERE id = ? AND user_id = ?
            """,
            (movie_id, user["id"]),
        ).fetchone()

        if movie is None:
            raise HTTPException(404, "Movie not found.")
        if movie["status"] != "completed":
            raise HTTPException(400, "Only completed movies can be reviewed.")

        db.execute(
            """
            INSERT INTO user_reviews
                (user_id, movie_id, rating, reaction, review_text, updated_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, movie_id) DO UPDATE SET
                rating = excluded.rating,
                reaction = excluded.reaction,
                review_text = excluded.review_text,
                updated_at = CURRENT_TIMESTAMP
            """,
            (
                user["id"], movie_id, review.rating,
                review.reaction, review.review_text.strip(),
            ),
        )

        row = db.execute(
            """
            SELECT rating, reaction, review_text, updated_at
            FROM user_reviews WHERE movie_id = ? AND user_id = ?
            """,
            (movie_id, user["id"]),
        ).fetchone()

    return dict(row)
@app.post("/api/admin-watchlist", status_code=201)
def add_admin_watchlist_movie(
    movie: MovieCreate,
    user: dict = Depends(get_current_user),
):
    # Only the provisioned admin account may publish shared recommendations.
    if user.get("role") != "admin":
        raise HTTPException(403, "Only the admin can add shared recommendations.")

    with get_db() as db:
        existing = db.execute(
            "SELECT id FROM admin_watchlist WHERE tmdb_id = ?",
            (movie.tmdb_id,),
        ).fetchone()
        if existing:
            raise HTTPException(409, "This movie is already in Admin Picks.")

        position = db.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM admin_watchlist"
        ).fetchone()[0]

        cursor = db.execute(
            """
            INSERT INTO admin_watchlist
                (tmdb_id, title, poster_path, release_date, vote_average, position)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                movie.tmdb_id,
                movie.title,
                movie.poster_path,
                movie.release_date,
                movie.vote_average,
                position,
            ),
        )
        row = db.execute(
            "SELECT * FROM admin_watchlist WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()

    return dict(row)


@app.get("/api/admin-watchlist")
def get_admin_watchlist():
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM admin_watchlist ORDER BY position, id"
        ).fetchall()

    return [dict(row) for row in rows]


@app.get("/")
def home():
    return FileResponse(FRONTEND_DIR / "index.html")


app.mount("/", StaticFiles(directory=FRONTEND_DIR), name="frontend")
