document.addEventListener("DOMContentLoaded", () => {
    const warning = document.getElementById("mobile-warning");

    if (!warning) return;

    const isMobile =
        /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ||
        window.innerWidth < 768;

    if (isMobile) {
        console.log("MOBILE")
        warning.classList.add("show"); // reveal warning
    }
});