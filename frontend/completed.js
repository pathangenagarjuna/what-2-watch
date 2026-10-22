
const grid = document.getElementById("completedGrid");
const count = document.getElementById("completedCount");

const POSTER_BASE = "https://image.tmdb.org/t/p/w500";
let completedMovies = [];

function escapeHTML(value = "") {
    return String(value).replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}


async function api(url, options = {}) {
    const token = sessionStorage.getItem("what2watch_token");

    const headers = {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers
    };

    const response = await fetch(url, {
        ...options,
        headers
    });

    const data = await response.json();

    if (!response.ok) {
        if (response.status === 401) {
            sessionStorage.removeItem("what2watch_token");
            sessionStorage.removeItem("what2watch_user");
            window.location.href = "/login.html";
        }

        throw new Error(data.detail || "Request failed");
    }

    return data;
}

// -------------------- RENDER MOVIE --------------------

function renderMovie(movie) {
    const movieId = movie.id;
    const poster = movie.poster_path
        ? `<img class="diary-poster"
            src="${POSTER_BASE}${encodeURIComponent(movie.poster_path)}"
            alt="${escapeHTML(movie.title)} poster">`
        : `<div class="diary-poster"></div>`;

    const savedRating = Number(movie.review_rating || 0);
    const reaction = movie.review_reaction || "";
    const review = movie.review_text || "";

    const reactions = [
        ["Loved it", "❤️ Loved it"],
        ["Amazing", "🔥 Amazing"],
        ["Average", "😐 Average"],
        ["Disappointed", "💔 Disappointed"]
    ];

    return `
        <article class="diary-card"
            data-movie-id="${movieId}"
            data-saved-rating="${savedRating}"
            data-selected-rating="${savedRating}">

            ${poster}

            <div class="diary-details">
                <h3 class="diary-title">${escapeHTML(movie.title)}</h3>

                <p class="diary-meta">
                    ${escapeHTML(movie.release_date?.slice(0, 4) || "Year unknown")}
                    · TMDB ★ ${Number(movie.vote_average || 0).toFixed(1)}
                </p>

                <div class="diary-actions">
                    <button class="remove-btn"
                        data-action="move-back" data-id="${movieId}">
                        ↩ Watch again
                    </button>

                    <button class="remove-btn"
                        data-action="remove" data-id="${movieId}">
                        Remove
                    </button>
                </div>

                <div class="review-panel">
                    <h4>Your rating</h4>

                    <div class="star-rating" role="group"
                        aria-label="Your rating for ${escapeHTML(movie.title)}">

                        ${[1, 2, 3, 4, 5].map(star => `
                            <button type="button"
                                class="star-btn ${star <= savedRating ? "selected" : ""}"
                                data-action="rate"
                                data-id="${movieId}"
                                data-rating="${star}"
                                aria-label="${star} star${star > 1 ? "s" : ""}"
                                aria-pressed="${star === savedRating}">
                                ★
                            </button>
                        `).join("")}
                    </div>

                    <label class="review-label"
                        for="reaction-${movieId}">Your reaction</label>

                    <select class="reaction-select" id="reaction-${movieId}">
                        <option value="">Choose your reaction</option>

                        ${reactions.map(([value, label]) => `
                            <option value="${value}"
                                ${reaction === value ? "selected" : ""}>
                                ${label}
                            </option>
                        `).join("")}
                    </select>

                    <label class="review-label"
                        for="review-${movieId}">Your review</label>

                    <textarea class="review-textarea"
                        id="review-${movieId}"
                        maxlength="3000"
                        placeholder="What did you think? What stood out?">${escapeHTML(review)}</textarea>

                    <button type="button"
                        class="add-btn review-save"
                        data-action="save-review"
                        data-id="${movieId}">
                        Save review
                    </button>

                    <p class="review-status"
                        id="status-${movieId}" aria-live="polite"></p>
                </div>
            </div>
        </article>
    `;
}

// -------------------- LOAD COMPLETED MOVIES --------------------

async function loadCompleted() {
    grid.innerHTML =
        '<div class="empty-state">Loading your movie diary...</div>';

    try {
        const data = await api("/api/movies?status=completed");

        completedMovies = data.results || [];

        count.textContent =
            `${completedMovies.length} ${completedMovies.length === 1 ? "movie" : "movies"}`;

        grid.innerHTML = completedMovies.length
            ? completedMovies.map(renderMovie).join("")
            : `<div class="empty-state">
                <span class="empty-icon">🎬</span>
                <h3>No completed movies yet.</h3>
                <p>Complete a movie from your watchlist to see it here.</p>
                <a href="/#watchlist">Go to your watchlist</a>
               </div>`;

    } catch (error) {
        grid.innerHTML = `
            <div class="empty-state">
                Could not load movies: ${escapeHTML(error.message)}
            </div>`;
    }
}

// -------------------- STAR RATING + MOVIE ACTIONS --------------------

grid.addEventListener("click", async event => {
    const button = event.target.closest("[data-action]");
    if (!button) return;

    const action = button.dataset.action;
    const id = Number(button.dataset.id);
    const card = button.closest(".diary-card");

    // Select a rating without submitting the review.
    if (action === "rate") {
        if (!card) return;

        const rating = Number(button.dataset.rating);

        if (rating < 1 || rating > 5) return;

        // Store the selected rating on this movie card.
        card.dataset.selectedRating = String(rating);

        // Update all five stars.
        card.querySelectorAll(".star-btn").forEach(star => {
            const starNumber = Number(star.dataset.rating);
            const selected = starNumber <= rating;

            star.classList.toggle("selected", selected);

            star.setAttribute(
                "aria-pressed",
                String(starNumber === rating)
            );
        });

        return;
    }

    button.disabled = true;

    const status = document.getElementById(`status-${id}`);

    try {
        // Save rating, reaction, and review together.
        if (action === "save-review") {
            if (!card) {
                throw new Error("Could not find this movie card.");
            }

            const rating = Number(
                card.dataset.selectedRating ||
                card.dataset.savedRating ||
                0
            );

            const reaction =
                card.querySelector(".reaction-select").value;

            const reviewText =
                card.querySelector(".review-textarea").value;

            if (rating < 1 || rating > 5) {
                throw new Error("Please select a star rating first.");
            }

            if (!reaction) {
                throw new Error("Please choose a reaction.");
            }

            await api(`/api/movies/${id}/review`, {
                method: "PUT",
                body: JSON.stringify({
                    rating,
                    reaction,
                    review_text: reviewText
                })
            });

            if (status) {
                status.textContent = "✓ Review saved successfully!";
            }

            // Reload from the database so saved stars remain yellow.
            await loadCompleted();
            return;
        }

        // Move a movie back to the watchlist.
        if (action === "move-back") {
            await api(`/api/movies/${id}`, {
                method: "PATCH",
                body: JSON.stringify({
                    status: "watchlist"
                })
            });
        }

        // Remove a movie.
        if (action === "remove") {
            await api(`/api/movies/${id}`, {
                method: "DELETE"
            });
        }

        await loadCompleted();

    } catch (error) {
        alert(error.message);

    } finally {
        button.disabled = false;
    }
});

// -------------------- THEME --------------------

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

// -------------------- START --------------------

loadCompleted();
