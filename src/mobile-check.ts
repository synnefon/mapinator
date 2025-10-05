function handleScreenSizeWarning(event) {
    const warning = document.getElementById("mobile-warning");
    if (!warning) return;

    const isMobile =
        /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ||
        window.innerWidth < 768;

    if (isMobile) {
        console.log("small screen detected (width=" + window.innerWidth + "px); showing warning...")
        warning.classList.add("show");
    } else {
        warning.classList.remove("show");
    }
}

window.addEventListener("resize", handleScreenSizeWarning, true);
document.addEventListener("DOMContentLoaded", handleScreenSizeWarning)
