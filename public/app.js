const REFRESH_MS = 60_000;
// Below this share of passed checks a bar is red. In a 2-hour bar it
// takes about 72 s down, so a single failed check stays yellow.
const DOWN_BELOW = 0.99;

const color = (up) =>
  up === null ? "var(--none)" : up ? "var(--up)" : "var(--down)";

function bucketColor(bucket) {
  if (!bucket) {
    return "var(--none)";
  }
  if (bucket.up === bucket.total) {
    return "var(--up)";
  }
  return bucket.up / bucket.total < DOWN_BELOW
    ? "var(--down)"
    : "var(--partial)";
}

// One bar per bucket, oldest first, grey where nothing was checked.
function bars(status, buckets) {
  const byStart = new Map(buckets.map((b) => [b.start, b]));
  const spans = [];

  for (let i = status.count - 1; i >= 0; i--) {
    const start = status.newest - i * status.bucketMs;
    const bucket = byStart.get(start);
    const time = new Date(start).toLocaleString([], {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    const span = document.createElement("span");
    span.style.background = bucketColor(bucket);
    span.title = bucket
      ? `${time}: ${((100 * bucket.up) / bucket.total).toFixed(2)}% up`
      : `${time}: no data`;
    spans.push(span);
  }
  return spans;
}

function uptime(buckets) {
  const up = buckets.reduce((n, b) => n + b.up, 0);
  const total = buckets.reduce((n, b) => n + b.total, 0);
  return total ? `${((100 * up) / total).toFixed(2)}%` : "–";
}

function card(status, m) {
  const el = document.createElement("section");
  el.className = "monitor";
  el.style.setProperty("--state", color(m.up));
  el.innerHTML = `
    <div class="head">
      <span class="name"></span>
      <span class="uptime"></span>
    </div>
    <div class="detail"></div>
    <div class="bars"></div>`;
  el.querySelector(".name").textContent = m.name;
  el.querySelector(".uptime").textContent = uptime(m.buckets);
  el.querySelector(".detail").textContent = m.detail;
  el.querySelector(".bars").append(...bars(status, m.buckets));
  return el;
}

async function render() {
  const summary = document.getElementById("summary");

  try {
    const response = await fetch("/api/status");
    const status = await response.json();
    const down = status.monitors.filter((m) => m.up === false);

    summary.textContent = down.length
      ? `Down: ${down.map((m) => m.name).join(", ")}`
      : "All systems operational";
    summary.style.background = down.length ? "var(--down)" : "var(--up)";
    document
      .getElementById("monitors")
      .replaceChildren(...status.monitors.map((m) => card(status, m)));
  } catch {
    summary.textContent = "Status unavailable";
    summary.style.background = "var(--none)";
  }
}

render();
setInterval(render, REFRESH_MS);
