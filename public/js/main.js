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
 * Elements only get the (opacity: 0) pre-animation state once JS has
 * actually attached the observer (.reveal-init, added below) — if this
 * script fails to load or run for any reason, content stays visible
 * instead of being permanently stuck invisible. See main.css.
 */
if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches && "IntersectionObserver" in window) {

    const revealElements = document.querySelectorAll(".reveal-element");

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

    revealElements.forEach(function (element) {

        element.classList.add("reveal-init");

        revealObserver.observe(element);

    });

}


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
 * Password show/hide toggle
 * Applies to every password field on the page (login, signup, reset,
 * change-password) without needing per-template markup.
 */
document
    .querySelectorAll('input[type="password"]')
    .forEach(function (input) {

        if (input.closest(".password-field-wrap")) return;

        const wrap = document.createElement("div");
        wrap.className = "password-field-wrap";
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);

        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "password-toggle-btn";
        toggle.setAttribute("aria-label", "Show password");
        toggle.innerHTML = '<i class="bi bi-eye"></i>';
        wrap.appendChild(toggle);

        toggle.addEventListener("click", function () {

            const showing = input.type === "text";
            input.type = showing ? "password" : "text";
            toggle.innerHTML = showing ? '<i class="bi bi-eye"></i>' : '<i class="bi bi-eye-slash"></i>';
            toggle.setAttribute("aria-label", showing ? "Show password" : "Hide password");

        });

    });


/*
 * Copy Course Link
 */
document
    .querySelectorAll(".copy-course-link")
    .forEach(function (button) {

        button.addEventListener("click", function () {

            const url = this.dataset.url || window.location.href;
            const label = this.innerHTML;

            const showCopied = () => {
                this.innerHTML = '<i class="bi bi-check-lg"></i> Copied';
                setTimeout(() => { this.innerHTML = label; }, 1800);
            };

            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(url).then(showCopied).catch(() => {});
            } else {
                const temp = document.createElement("textarea");
                temp.value = url;
                temp.style.position = "fixed";
                temp.style.opacity = "0";
                document.body.appendChild(temp);
                temp.select();
                try { document.execCommand("copy"); showCopied(); } catch (e) {}
                document.body.removeChild(temp);
            }

        });

    });
