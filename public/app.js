const MINUTE_MS = 60_000;
const REFRESH_MS = MINUTE_MS;
// Below this share of passed checks a bar is red. In a day's bar it takes
// about 86 s down, so a single failed check stays yellow.
const DOWN_BELOW = 0.999;
// Three decimals tell 99.99% from 99.999%.
const UPTIME_DIGITS = 3;

const tip = document.getElementById("tip");
// The tooltip content of each bar, built with the bar.
const tips = new WeakMap();

function state(up) {
  if (up === null) {
    return ["Not checked yet", "var(--none)"];
  }
  return up ? ["Operational", "var(--up)"] : ["Down", "var(--down)"];
}

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

function percent(up, total) {
  return `${((100 * up) / total).toFixed(UPTIME_DIGITS)}%`;
}

// Days and times are UTC, the days D1 counts the checks in.
function day(at) {
  return new Date(at).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function clock(at) {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  });
}

function duration(ms) {
  const minutes = Math.max(1, Math.round(ms / MINUTE_MS));

  if (minutes < 60) {
    return `${minutes} min`;
  }
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

// An open incident has no end yet and lasts until now.
function span(i) {
  const end = i.ended === null ? "ongoing" : clock(i.ended);
  return `${clock(i.started)} to ${end}`;
}

function lasted(i) {
  return duration((i.ended ?? Date.now()) - i.started);
}

function element(tag, text) {
  const el = document.createElement(tag);
  el.textContent = text;
  return el;
}

// The tooltip of one day's bar: the date, the uptime, and a table of the
// incidents that touched the day. The label reads the same as text.
function dayTip(start, length, bucket, incidents) {
  const date = element("strong", day(start));

  if (!bucket) {
    const text = "No data exists for this day.";
    return {
      label: `${day(start)}. ${text}`,
      nodes: [date, element("p", text)],
    };
  }

  const touched = incidents.filter(
    (i) => i.started < start + length && (i.ended ?? Infinity) >= start,
  );
  if (touched.length === 0 && bucket.up === bucket.total) {
    const text = "No downtime recorded on this day.";
    return {
      label: `${day(start)}. ${text}`,
      nodes: [date, element("p", text)],
    };
  }

  const up = `${percent(bucket.up, bucket.total)} up`;
  const nodes = [date, element("p", up)];
  if (touched.length > 0) {
    const table = document.createElement("table");
    table
      .createTHead()
      .insertRow()
      .append(element("th", "Down"), element("th", "Duration"));
    const body = table.createTBody();
    for (const i of touched) {
      body.insertRow().append(element("td", span(i)), element("td", lasted(i)));
    }
    nodes.push(table);
  }

  const downs = touched.map((i) => `Down ${span(i)}, ${lasted(i)}`);
  return { label: [day(start), up, ...downs].join(". "), nodes };
}

// One bar per bucket, oldest first, grey where nothing was checked.
function bars(status, m, incidents) {
  const byStart = new Map(m.buckets.map((b) => [b.start, b]));
  const spans = [];

  for (let i = status.count - 1; i >= 0; i--) {
    const start = status.newest - i * status.bucketMs;
    const bucket = byStart.get(start);
    const bar = document.createElement("span");
    bar.style.background = bucketColor(bucket);
    const { label, nodes } = dayTip(start, status.bucketMs, bucket, incidents);
    bar.setAttribute("aria-label", label);
    tips.set(bar, nodes);
    spans.push(bar);
  }
  return spans;
}

function uptime(buckets) {
  const up = buckets.reduce((n, b) => n + b.up, 0);
  const total = buckets.reduce((n, b) => n + b.total, 0);
  return total ? `${percent(up, total)} uptime` : "No data";
}

function card(status, m) {
  const [word, color] = state(m.up);
  const incidents = status.incidents.filter((i) => i.monitor === m.id);
  const el = document.createElement("section");
  el.className = "monitor";
  el.style.setProperty("--state", color);
  el.innerHTML = `
    <div class="head">
      <span class="name"></span>
      <span class="state"></span>
    </div>
    <div class="detail"></div>
    <div class="bars"></div>
    <div class="axis">
      <span class="oldest"></span>
      <span class="uptime"></span>
      <span>Today</span>
    </div>`;
  el.querySelector(".name").textContent = m.name;
  el.querySelector(".state").textContent = word;
  el.querySelector(".detail").textContent = m.detail;
  el.querySelector(".bars").append(...bars(status, m, incidents));
  el.querySelector(".oldest").textContent = `${status.count} days ago`;
  el.querySelector(".uptime").textContent = uptime(m.buckets);
  return el;
}

// Centers the tooltip below the bar and keeps it inside the window.
function showTip(bar) {
  tip.replaceChildren(...tips.get(bar));
  tip.hidden = false;

  const rect = bar.getBoundingClientRect();
  const width = tip.offsetWidth;
  const max = document.documentElement.clientWidth - width - 8;
  const left = Math.min(
    Math.max(8, rect.left + rect.width / 2 - width / 2),
    max,
  );
  tip.style.left = `${left + window.scrollX}px`;
  tip.style.top = `${rect.bottom + window.scrollY + 8}px`;
}

// Pointer events cover a mouse's hover and a finger's tap alike.
document.addEventListener("pointerover", (event) => {
  const bar = event.target.closest(".bars span");

  if (bar) {
    showTip(bar);
  } else {
    tip.hidden = true;
  }
});

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
