/*
 * main.js
 * Extracted from the original static site (backup/original/).
 * Same behavior as before: sticky nav, scroll-reveal, client-side course
 * filtering, mobile nav auto-close, and the wishlist icon toggle.
 * Newsletter/login/signup submit handling is intentionally left as-is for
 * now (no real backend calls yet) — that comes in a later phase.
 */

/*
 * Sticky Navigation
 */
const navigationBar = document.querySelector(".main-navigation");

window.addEventListener("scroll", function () {

    if (window.scrollY > 30) {
        navigationBar.classList.add("sticky-active");
    } else {
        navigationBar.classList.remove("sticky-active");
    }

});


/*
 * Scroll Reveal Animation
 */
const revealObserver = new IntersectionObserver(
    function (entries) {

        entries.forEach(function (entry) {

            if (entry.isIntersecting) {

                entry.target.classList.add("visible");

                revealObserver.unobserve(entry.target);

            }

        });

    },
    {
        threshold: .12
    }
);


document
    .querySelectorAll(".reveal-element")
    .forEach(function (element) {

        revealObserver.observe(element);

    });


/*
 * Course Search (client-side filter of currently rendered course cards)
 */
const courseSearchInput = document.querySelector(".hero-search input");

const courseCards = document.querySelectorAll(".course-card");

if (courseSearchInput) {

    courseSearchInput.addEventListener("input", function () {

        const searchValue = this.value.toLowerCase().trim();

        courseCards.forEach(function (card) {

            const courseText = card.innerText.toLowerCase();

            const courseColumn = card.closest(".col-md-6");

            if (courseText.includes(searchValue)) {

                courseColumn.style.display = "";

            } else {

                courseColumn.style.display = "none";

            }

        });

    });

}


/*
 * Newsletter Demo
 * NOTE: still a placeholder — this only updates the button label and does
 * not submit anywhere yet. Wiring to a real endpoint happens in a later
 * phase (see README "Next Phase").
 */
const newsletterForm = document.querySelector(".newsletter-form");

if (newsletterForm) {

    newsletterForm.addEventListener("submit", function (event) {

        event.preventDefault();

        const button = this.querySelector("button");

        button.innerText = "Subscribed ✓";

        button.disabled = true;

    });

}


/*
 * Smooth navigation close on mobile
 */
document
    .querySelectorAll(".navigation-link")
    .forEach(function (link) {

        link.addEventListener("click", function () {

            const navigationMenu =
                document.querySelector("#mainNavigation");

            if (navigationMenu.classList.contains("show")) {

                bootstrap.Collapse
                    .getOrCreateInstance(navigationMenu)
                    .hide();

            }

        });

    });


/*
 * Wishlist Animation
 * NOTE: client-side only, not persisted to an account yet.
 */
document
    .querySelectorAll(".course-wishlist")
    .forEach(function (button) {

        button.addEventListener("click", function () {

            const icon = this.querySelector("i");

            if (icon.classList.contains("bi-heart")) {

                icon.classList.remove("bi-heart");

                icon.classList.add("bi-heart-fill");

                this.style.color = "#565acf";

            } else {

                icon.classList.remove("bi-heart-fill");

                icon.classList.add("bi-heart");

                this.style.color = "";

            }

        });

    });
