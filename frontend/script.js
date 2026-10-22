const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("searchInput");
const movieGrid = document.getElementById("movieGrid");
const resultsTitle = document.getElementById("resultsTitle");
const resultCount = document.getElementById("resultCount");
const watchlistGrid = document.getElementById("watchlistGrid");
const watchlistCount = document.getElementById("watchlistCount");

const adminWatchlistGrid = document.getElementById("adminWatchlistGrid");
const adminWatchlistCount = document.getElementById("adminWatchlistCount");

let adminWatchlist = [];

const POSTER_BASE = "https://image.tmdb.org/t/p/w500";

let searchResults = [];
let watchlist = [];
let completed = [];
let draggedQueueItem = null;

// -------------------- API --------------------
const API_BASE_URL = "https://what-2-watch-api.onrender.com";
async function api(url, options = {}) {
    const token = sessionStorage.getItem("what2watch_token");

    const headers = {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers
    };

  
const response = await fetch(
    url.startsWith("http") ? url : `${API_BASE_URL}${url}`,
    {
        ...options,
        headers
    }
);

    const data = await response.json();

    if (!response.ok) {
        if (response.status === 401 && !url.startsWith("/api/auth/")) {
            sessionStorage.removeItem("what2watch_token");
            sessionStorage.removeItem("what2watch_user");
            window.location.href = "/login.html";
        }

        throw new Error(data.detail || "Request failed");
    }

    return data;
}

// -------------------- HELPERS --------------------

function escapeHTML(value = "") {
    return String(value).replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

function getTmdbId(movie) {
    return movie.tmdb_id ?? movie.id;
}

function getCurrentUser() {
    try {
        return JSON.parse(
            sessionStorage.getItem("what2watch_user") || "null"
        );
    } catch {
        return null;
    }
}

function isAdminUser() {
    return getCurrentUser()?.role === "admin";
}

// -------------------- SEARCH MOVIE CARDS --------------------


function movieCard(movie, mode = "search") {
    const title = escapeHTML(movie.title);
    const poster = movie.poster_path
        ? `<img class="poster"
                src="${POSTER_BASE}${encodeURIComponent(movie.poster_path)}"
                alt="${title} poster"
                loading="lazy">`
        : `<div class="poster-placeholder">Poster unavailable</div>`;

    const year = movie.release_date
        ? escapeHTML(movie.release_date.slice(0, 4))
        : "Year unknown";

    const rating = Number(movie.vote_average || 0).toFixed(1);
    let actions = "";

    if (mode === "search") {
        const id = getTmdbId(movie);

        if (isAdminUser()) {
            const alreadyRecommended = adminWatchlist.some(
                saved => Number(getTmdbId(saved)) === Number(id)
            );

            actions = `
                <button class="add-btn"
                    data-action="admin-add"
                    data-movie-id="${id}"
                    ${alreadyRecommended ? "disabled" : ""}>
                    ${alreadyRecommended
                        ? "✓ Already in Admin Picks"
                        : "+ Add to Admin Picks"}
                </button>`;
        } else {
            const alreadyAdded =
                watchlist.some(
                    saved => Number(getTmdbId(saved)) === Number(id)
                ) ||
                completed.some(
                    saved => Number(getTmdbId(saved)) === Number(id)
                );

            actions = `
                <button class="add-btn"
                    data-action="add"
                    data-movie-id="${id}"
                    ${alreadyAdded ? "disabled" : ""}>
                    ${alreadyAdded
                        ? "✓ Already added"
                        : "+ Add to watchlist"}
                </button>`;
        }
    } else if (mode === "completed") {
        actions = `
            <a class="add-btn" href="/completed.html">
                Open Movie Diary
            </a>`;
    } else if (mode === "admin" && isAdminUser()) {
        actions = `
            <button class="remove-btn"
                data-action="admin-remove"
                data-movie-id="${movie.id}">
                Remove recommendation
            </button>`;
    }

    return `
        <article class="movie-card">
            ${poster}
            <div class="movie-info">
                <h3>${title}</h3>
                <p class="movie-meta">${year} · ★ ${rating}</p>
                ${actions}
            </div>
        </article>`;
}


// -------------------- SEARCH RESULTS --------------------

function renderSearchResults() {
    if (!movieGrid || !resultCount) return;

    resultCount.textContent = `${searchResults.length} movies`;

    movieGrid.innerHTML = searchResults.length
        ? searchResults.map(movie => movieCard(movie, "search")).join("")
        : `<div class="empty-state">
               <h3>No movies found</h3>
               <p>Try searching for another title.</p>
           </div>`;
}
// -------------------- WATCHLIST QUEUE --------------------

function renderMovieList(container, movies, mode) {
    if (!container) return;

    if (mode !== "watchlist") {
        container.innerHTML = movies.length
            ? movies.map(movie => movieCard(movie, mode)).join("")
            : `<div class="empty-state">
                   <span class="empty-icon">🎬</span>
                   <h3>No completed movies yet.</h3>
                   <p>Open your movie diary to see your completed films.</p>
                   <a href="/completed.html">Open Completed Movies →</a>
               </div>`;
        return;
    }

    container.innerHTML = movies.length
        ? movies.map((movie, index) => `
            <article class="queue-item"
                draggable="true"
                data-queue-id="${movie.id}">

                <span class="queue-number">${index + 1}</span>

                <span class="drag-handle" draggable="true"
                    title="Drag to reorder"
                    aria-label="Drag to reorder">⠿</span>

                ${movie.poster_path
                    ? `<img class="queue-poster"
                            src="${POSTER_BASE}${encodeURIComponent(movie.poster_path)}"
                            alt="${escapeHTML(movie.title)} poster"
                            loading="lazy">`
                    : `<div class="queue-poster"></div>`}

                <div class="queue-details">
                    <h3>${escapeHTML(movie.title)}</h3>
                    <p>${escapeHTML(movie.release_date || "Release date unknown")}</p>
                    <p>★ ${Number(movie.vote_average || 0).toFixed(1)}</p>
                </div>

                <div class="queue-actions">
                    <button class="add-btn"
                        data-action="complete"
                        data-movie-id="${movie.id}">
                        ✓ Completed
                    </button>

                    <button class="remove-btn"
                        data-action="remove"
                        data-movie-id="${movie.id}">
                        Remove
                    </button>
                </div>
            </article>
        `).join("")
        : `<div class="empty-state">
               <span class="empty-icon">🍿</span>
               <h3>Your watchlist is empty.</h3>
               <p>Search for a movie and add it here.</p>
           </div>`;
}

// -------------------- COMPLETED MOVIE PREVIEW --------------------

function renderCompletedPreview() {
    const preview = document.getElementById("completedPreview");
    if (!preview) return;

    const count = document.getElementById("completedCount");

    if (count) {
        count.textContent =
            `${completed.length} ${completed.length === 1 ? "movie" : "movies"}`;
    }

    const recentMovies = [...completed].reverse().slice(0, 8);

    preview.innerHTML = recentMovies.length
        ? recentMovies.map(movie => `
            <a class="completed-preview-card"
                href="/completed.html"
                title="${escapeHTML(movie.title)}">

                ${movie.poster_path
                    ? `<img class="completed-preview-poster"
                            src="${POSTER_BASE}${encodeURIComponent(movie.poster_path)}"
                            alt="${escapeHTML(movie.title)} poster"
                            loading="lazy">`
                    : `<div class="completed-preview-empty">
                            Poster unavailable
                       </div>`}

                <p class="completed-preview-title">
                    ${escapeHTML(movie.title)}
                </p>
            </a>
        `).join("")
        : `<div class="completed-preview-empty">
                Your movie diary is waiting.
                Complete a movie to see its poster here!
           </div>`;
}

// -------------------- ADMIN WATCHLIST --------------------

async function loadAdminWatchlist() {
    if (!adminWatchlistGrid) return;

    try {
        const data = await api("/api/admin-watchlist");

        // The endpoint currently returns a plain list.
        adminWatchlist = Array.isArray(data)
            ? data
            : (data.results || []);

        if (adminWatchlistCount) {
            adminWatchlistCount.textContent =
                `${adminWatchlist.length} ${
                    adminWatchlist.length === 1 ? "movie" : "movies"
                }`;
        }

        adminWatchlistGrid.innerHTML = adminWatchlist.length
            ? adminWatchlist.map(movie => movieCard(movie, "admin")).join("")
            : `<div class="empty-state">
                    <span class="empty-icon">🍿</span>
                    <h3>No recommendations yet.</h3>
                    <p>Admin recommendations will appear here.</p>
               </div>`;
    } catch (error) {
        adminWatchlistGrid.innerHTML = `
            <div class="empty-state">
                <h3>Could not load recommendations</h3>
                <p>${escapeHTML(error.message)}</p>
            </div>`;
    }
}

// -------------------- LOAD DATABASE LISTS --------------------

async function loadLists() {
    try {
        const [watchlistData, completedData] = await Promise.all([
            api("/api/movies?status=watchlist"),
            api("/api/movies?status=completed")
        ]);

        watchlist = watchlistData.results || [];
        completed = completedData.results || [];

        renderCompletedPreview();

        if (watchlistCount) {
            watchlistCount.textContent =
                `${watchlist.length} ${watchlist.length === 1 ? "movie" : "movies"}`;
        }

        renderMovieList(watchlistGrid, watchlist, "watchlist");
        renderSearchResults();

    } catch (error) {
        if (watchlistGrid) {
            watchlistGrid.innerHTML = `
                <div class="empty-state">
                    <h3>Could not load your movies</h3>
                    <p>${escapeHTML(error.message)}</p>
                </div>`;
        }
    }
}
// -------------------- TMDB SEARCH --------------------

if (searchForm) {
    searchForm.addEventListener("submit", async event => {
        event.preventDefault();

        const query = searchInput.value.trim();
        if (!query) return;

        resultsTitle.textContent = "Searching...";
        movieGrid.innerHTML =
            '<div class="empty-state">Searching TMDB...</div>';

        try {
            const data = await api(
                `/api/search?query=${encodeURIComponent(query)}`
            );

            searchResults = data.results || [];

            resultsTitle.textContent = `Results for "${query}"`;
            renderSearchResults();

        } catch (error) {
            searchResults = [];

            movieGrid.innerHTML = `
                <div class="empty-state">
                    <h3>Search failed</h3>
                    <p>${escapeHTML(error.message)}</p>
                </div>`;
        }
    });
}

// -------------------- MOVIE ACTIONS --------------------

document.addEventListener("click", async event => {
    const button = event.target.closest("[data-action]");
    if (!button) return;

    const action = button.dataset.action;
    const id = Number(button.dataset.movieId);

    // Stars and review forms belong to completed.html.
    if (action === "rate") {
        const rating = Number(button.dataset.rating);
        const card = button.closest(".diary-card");

        if (!card || rating < 1 || rating > 5) return;

        const stars = card.querySelectorAll(".star-btn");

        stars.forEach(star => {
            const starNumber = Number(star.dataset.rating);
            const selected = starNumber <= rating;

            star.classList.toggle("selected", selected);
            star.setAttribute(
                "aria-pressed",
                String(starNumber === rating)
            );
        });

        card.dataset.selectedRating = String(rating);
        return;
    }

    button.disabled = true;

    try {
        if (action === "add" || action === "admin-add") {
            const movie = searchResults.find(
                item => Number(getTmdbId(item)) === id
            );

            if (!movie) {
                throw new Error("Movie not found in search results.");
            }

            const moviePayload = {
                tmdb_id: id,
                title: movie.title,
                poster_path: movie.poster_path,
                release_date: movie.release_date,
                vote_average: movie.vote_average
            };

            if (action === "admin-add") {
                if (!isAdminUser()) {
                    throw new Error(
                        "Only the admin can add shared recommendations."
                    );
                }

                // Requires a POST /api/admin-watchlist endpoint
                // that verifies the user's admin role in the backend.
                await api("/api/admin-watchlist", {
                    method: "POST",
                    body: JSON.stringify(moviePayload)
                });

                await loadAdminWatchlist();
                renderSearchResults();
                return;
            }

            await api("/api/movies", {
                method: "POST",
                body: JSON.stringify(moviePayload)
            });
        }

        if (action === "complete" || action === "move-back") {
            await api(`/api/movies/${id}`, {
                method: "PATCH",
                body: JSON.stringify({
                    status: action === "complete"
                        ? "completed"
                        : "watchlist"
                })
            });
        }

        if (action === "remove") {
            await api(`/api/movies/${id}`, {
                method: "DELETE"
            });
        }
        
        if (action === "admin-remove") {
            if (!isAdminUser()) {
                throw new Error(
                    "Only the admin can remove recommendations."
                );
            }

            if (!confirm(
                "Remove this recommendation for everyone?"
            )) {
                return;
            }

            await api(`/api/admin-watchlist/${id}`, {
                method: "DELETE"
            });

            await loadAdminWatchlist();
            renderSearchResults();
            return;
        }

        await loadLists();

    } catch (error) {
        alert(error.message);

    } finally {
        button.disabled = false;
    }
});

// -------------------- DRAG AND DROP QUEUE --------------------

if (watchlistGrid) {
    watchlistGrid.addEventListener("dragstart", event => {
        const item = event.target.closest(".queue-item");
        if (!item) return;

        if (!event.target.closest(".drag-handle")) {
            event.preventDefault();
            return;
        }

        draggedQueueItem = item;
        item.classList.add("dragging");

        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData(
                "text/plain",
                item.dataset.queueId
            );
        }
    });

    watchlistGrid.addEventListener("dragover", event => {
        event.preventDefault();

        const target = event.target.closest(".queue-item");

        if (!target || !draggedQueueItem || target === draggedQueueItem) {
            return;
        }

        watchlistGrid.querySelectorAll(".drag-over").forEach(item => {
            item.classList.remove("drag-over");
        });

        target.classList.add("drag-over");

        const rect = target.getBoundingClientRect();
        const insertAfter = event.clientY > rect.top + rect.height / 2;

        watchlistGrid.insertBefore(
            draggedQueueItem,
            insertAfter ? target.nextSibling : target
        );
    });

    watchlistGrid.addEventListener("drop", async event => {
        event.preventDefault();

        if (!draggedQueueItem) return;

        const movieIds = [
            ...watchlistGrid.querySelectorAll(".queue-item")
        ].map(item => Number(item.dataset.queueId));

        try {
            await api("/api/movies/reorder", {
                method: "PUT",
                body: JSON.stringify({ movie_ids: movieIds })
            });

            await loadLists();

        } catch (error) {
            alert("Could not save queue order: " + error.message);
            await loadLists();
        }
    });

    watchlistGrid.addEventListener("dragend", () => {
        draggedQueueItem?.classList.remove("dragging");

        watchlistGrid.querySelectorAll(".drag-over").forEach(item => {
            item.classList.remove("drag-over");
        });

        draggedQueueItem = null;
    });
}
// -------------------- DARK / LIGHT THEME --------------------

const themeToggle = document.getElementById("themeToggle");

function applyTheme(theme) {
    document.body.classList.toggle("light", theme === "light");

    if (themeToggle) {
        themeToggle.textContent = theme === "light" ? "☾" : "☀";
    }
}

if (themeToggle) {
    themeToggle.addEventListener("click", () => {
        const nextTheme = document.body.classList.contains("light")
            ? "dark"
            : "light";

        localStorage.setItem("w2w-theme", nextTheme);
        applyTheme(nextTheme);
    });
}

applyTheme(localStorage.getItem("w2w-theme") || "dark");
// Background slideshow
document.addEventListener("DOMContentLoaded", () => {
    const slides = document.querySelectorAll(".background-slide");

    if (slides.length === 0) return;

    let currentSlide = 0;

    setInterval(() => {
        slides[currentSlide].classList.remove("active");

        currentSlide = (currentSlide + 1) % slides.length;

        slides[currentSlide].classList.add("active");
    }, 2500); // Change image every 7 seconds
});


/* What 2 Watch - Button Click Sounds */

/* What 2 Watch - Click Sounds */
(() => {
    let soundsEnabled = true;
    let audioContext = null;

    function playClickSound() {
        if (!soundsEnabled) return;

        try {
            const AudioContextClass =
                window.AudioContext || window.webkitAudioContext;

            if (!AudioContextClass) {
                console.warn("Web Audio is not supported.");
                return;
            }

            if (!audioContext) {
                audioContext = new AudioContextClass();
            }

            if (audioContext.state === "suspended") {
                audioContext.resume();
            }

            const oscillator = audioContext.createOscillator();
            const gain = audioContext.createGain();

            oscillator.type = "sine";
            oscillator.frequency.value = 700;

            gain.gain.setValueAtTime(0.20, audioContext.currentTime);
            gain.gain.exponentialRampToValueAtTime(
                0.001,
                audioContext.currentTime + 0.12
            );

            oscillator.connect(gain);
            gain.connect(audioContext.destination);

            oscillator.start();
            oscillator.stop(audioContext.currentTime + 0.12);
        } catch (error) {
            console.error("Click sound error:", error);
        }
    }

    document.addEventListener("click", (event) => {
        const button = event.target.closest(
            "button, [role='button'], input[type='button'], " +
            "input[type='submit'], a.button, .btn"
        );

        if (!button || button.id === "sound-toggle" || button.disabled) {
            return;
        }

        playClickSound();
    }, true);

    document.addEventListener("DOMContentLoaded", () => {
        const soundButton = document.getElementById("sound-toggle");
        if (!soundButton) return;

        soundButton.addEventListener("click", () => {
            soundsEnabled = !soundsEnabled;

            soundButton.textContent = soundsEnabled
                ? "🔊 Sound On"
                : "🔇 Sound Off";

            soundButton.setAttribute("aria-pressed", String(soundsEnabled));
        });
    });
})();
// -------------------- START --------------------

loadLists();
loadAdminWatchlist();