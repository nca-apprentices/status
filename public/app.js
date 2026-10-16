const MINUTE_MS = 60_000;
const REFRESH_MS = MINUTE_MS;
// Below this share of passed checks a bar is red. In a day's bar it takes
// about 86 s down, so a single failed check stays yellow.
const DOWN_BELOW = 0.999;
// Three decimals tell 99.99% from 99.999%.
const UPTIME_DIGITS = 3;

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
    const time = new Date(start).toLocaleDateString([], {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    const span = document.createElement("span");
    span.style.background = bucketColor(bucket);
    span.title = bucket
      ? `${time}: ${percent(bucket.up, bucket.total)} up`
      : `${time}: no data`;
    spans.push(span);
  }
  return spans;
}

function uptime(buckets) {
  const up = buckets.reduce((n, b) => n + b.up, 0);
  const total = buckets.reduce((n, b) => n + b.total, 0);
  return total ? percent(up, total) : "–";
}

function percent(up, total) {
  return `${((100 * up) / total).toFixed(UPTIME_DIGITS)}%`;
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

function when(at) {
  return new Date(at).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function duration(ms) {
  const minutes = Math.max(1, Math.round(ms / MINUTE_MS));

  if (minutes < 60) {
    return `${minutes} min`;
  }
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

// Newest first, as the API sends them. An open incident has no end yet.
function incidents(status) {
  const names = new Map(status.monitors.map((m) => [m.id, m.name]));
  const days = (status.count * status.bucketMs) / (24 * 60 * MINUTE_MS);

  if (status.incidents.length === 0) {
    const li = document.createElement("li");
    li.textContent = `No incidents in the last ${days} days.`;
    return [li];
  }

  return status.incidents.map((i) => {
    const li = document.createElement("li");
    const name = names.get(i.monitor) ?? i.monitor;
    li.textContent =
      i.ended === null
        ? `${name} down since ${when(i.started)}`
        : `${name} down ${when(i.started)} to ${when(i.ended)}, ` +
          duration(i.ended - i.started);
    return li;
  });
}

async function render() {
  const summary = document.getElementById("summary");

  try {
    // Skips a response a browser cached for hours before the API sent no-store.
    const response = await fetch("/api/status", { cache: "no-store" });
    const status = await response.json();
    const down = status.monitors.filter((m) => m.up === false);

    summary.textContent = down.length
      ? `Down: ${down.map((m) => m.name).join(", ")}`
      : "All systems operational";
    summary.style.background = down.length ? "var(--down)" : "var(--up)";
    document
      .getElementById("monitors")
      .replaceChildren(...status.monitors.map((m) => card(status, m)));
    document.getElementById("incidents").replaceChildren(...incidents(status));
  } catch {
    summary.textContent = "Status unavailable";
    summary.style.background = "var(--none)";
  }
}

// A hidden tab skips its refreshes and catches up once shown again.
function refresh() {
  if (!document.hidden) {
    render();
  }
}

render();
setInterval(refresh, REFRESH_MS);
document.addEventListener("visibilitychange", refresh);
