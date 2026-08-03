document.querySelectorAll(".social").forEach((item) => {
  item.addEventListener("toggle", () => {
    if (!item.open) return;
    document.querySelectorAll(".social").forEach((other) => {
      if (other !== item) other.open = false;
    });
  });
});
