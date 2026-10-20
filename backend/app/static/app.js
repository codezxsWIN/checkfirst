// CallAI web page
//
// What this file does:
//   1. Tabs       - shows one of the three sections: Home, Scheduled or Contacts
//   2. Home       - sends what the user typed to the server and shows the answer
//   3. Scheduled  - lists the calls of the user and lets them cancel one
//
// It talks to the Flask backend with fetch():
//   POST   /schedule-call    send the typed text (later also: the missing details, the confirmation)
//   GET    /calls?user_id=   get the upcoming and past calls
//   DELETE /calls/<id>       cancel a call that has not happened yet
//   GET    /health           check that the backend is running

const IST = "Asia/Kolkata"; // every call time is shown in Indian time


// ---------- The page elements we use ----------

// Home: the form
const scheduleForm = document.getElementById("schedule-form");
const promptInput = document.getElementById("prompt-input");
const sendButton = document.getElementById("send-button");
const sendLabel = document.getElementById("send-label");
const formError = document.getElementById("form-error");

// Home: the boxes under the form
const processingBox = document.getElementById("processing-box");
const missingBox = document.getElementById("missing-box");
const confirmBox = document.getElementById("confirm-box");

// The inputs of the "missing details" box. The keys are the field names the server uses.
const missingInputs = {
  contact_name: document.getElementById("missing-name"),
  contact_number: document.getElementById("missing-number"),
  message: document.getElementById("missing-message"),
  scheduled_time: document.getElementById("missing-time"),
};
const continueButton = document.getElementById("continue-button");

// The "confirm" box
const confirmName = document.getElementById("confirm-name");
const confirmNumber = document.getElementById("confirm-number");
const confirmTime = document.getElementById("confirm-time");
const confirmMessage = document.getElementById("confirm-message");
const confirmButton = document.getElementById("confirm-button");
const editButton = document.getElementById("edit-button");

// Scheduled: the lists
const upcomingList = document.getElementById("upcoming-list");
const pastList = document.getElementById("past-list");
const upcomingCount = document.getElementById("upcoming-count");
const pastCount = document.getElementById("past-count");
const callsError = document.getElementById("calls-error");
const refreshButton = document.getElementById("refresh-button");
const callTemplate = document.getElementById("call-template");

// Contacts: the details we send with every request, and the box that shows the last server answer
const userIdInput = document.getElementById("user-id");
const userNameInput = document.getElementById("user-name");
const contactsInput = document.getElementById("contacts");
const healthPill = document.getElementById("health-pill");
const lastReply = document.getElementById("last-reply");

// What the server understood from the typed text. We send it back when the user confirms.
let draft = null;


// ---------- Tabs ----------

// Shows one section ("home", "scheduled" or "contacts") and hides the others
function showView(name) {
  for (const view of document.querySelectorAll(".view")) {
    view.hidden = view.id !== name + "-view";
  }
  for (const tab of document.querySelectorAll(".nav-item")) {
    const isOpen = tab.dataset.view === name;
    tab.classList.toggle("active", isOpen); // the open tab is highlighted
    if (isOpen) {
      tab.setAttribute("aria-current", "page"); // tells screen readers which tab is open
    } else {
      tab.removeAttribute("aria-current");
    }
  }
  window.scrollTo(0, 0);

  if (name === "scheduled") {
    loadCalls(); // always show up-to-date calls
  }
}

// Every button with a data-view (the three tabs and the icon in the corner) opens that section
for (const button of document.querySelectorAll("[data-view]")) {
  button.addEventListener("click", () => showView(button.dataset.view));
}

// The top bar only gets a line underneath once the page is scrolled
window.addEventListener("scroll", () => {
  document.querySelector(".site-header").classList.toggle("is-scrolled", window.scrollY > 4);
});


// ---------- Small helpers ----------

function showError(text) {
  formError.textContent = text;
  formError.hidden = false;
}

// Turns a time from the server into text like "Wednesday, 21 October 2026 at 4:00 pm IST"
function formatTime(isoText) {
  const date = new Date(isoText);
  return date.toLocaleString("en-IN", { timeZone: IST, dateStyle: "full", timeStyle: "short" }) + " IST";
}

// +919812345678 becomes +91 98123 45678 (with non-breaking spaces, so the number never splits over two lines)
function formatPhone(number) {
  if (number.length === 13 && number.startsWith("+91")) {
    return number.slice(0, 3) + "\u00a0" + number.slice(3, 8) + "\u00a0" + number.slice(8);
  }
  return number;
}

// Reads the contacts box. Each line looks like: Ayush Waman, +918879279251
function getContacts() {
  const contacts = [];
  for (const line of contactsInput.value.split("\n")) {
    const parts = line.split(",");
    const name = parts[0].trim();
    const number = (parts[1] || "").trim();
    if (name && number) {
      contacts.push({ name: name, number: number });
    }
  }
  return contacts;
}

// The basic request the server needs
function buildRequest() {
  return {
    user_id: userIdInput.value.trim(),
    user_name: userNameInput.value.trim(),
    raw_prompt: promptInput.value.trim(),
    contacts: getContacts(),
  };
}

// "Good morning, Ayush" - the greeting depends on the hour. The name is also used in the example card.
function updateGreeting() {
  const hour = new Date().getHours();
  let hello = "Good evening";
  if (hour < 12) {
    hello = "Good morning";
  } else if (hour < 17) {
    hello = "Good afternoon";
  }

  const name = userNameInput.value.trim();
  document.getElementById("greeting").textContent = name ? hello + ", " + name : hello;
  for (const place of document.querySelectorAll("[data-user-name]")) {
    place.textContent = name || "your name";
  }
}


// ---------- Home: scheduling a call ----------

// While we wait for the server: show the "Working on it" box and block the buttons, so nothing is sent twice
function setBusy(isBusy) {
  for (const button of [sendButton, continueButton, confirmButton]) {
    button.disabled = isBusy;
  }
  sendLabel.textContent = isBusy ? "Working…" : "Preview call";
  processingBox.hidden = !isBusy;
}

// Sends one request to /schedule-call and deals with the answer
async function sendToServer(body) {
  formError.hidden = true;
  setBusy(true);

  let data = {};
  let errorText = ""; // stays empty when everything went well

  try {
    const response = await fetch("/schedule-call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    data = await response.json().catch(() => ({})); // an error page is not JSON
    if (!response.ok) {
      errorText = data.message || "Something went wrong. Please try again.";
    }
  } catch (error) {
    errorText = "Couldn't reach the backend. Check that it's running and try again.";
  }

  setBusy(false); // the answer is here, so the buttons work again
  lastReply.textContent = JSON.stringify(errorText ? { status: "error", message: errorText } : data, null, 2);

  if (errorText) {
    showError(errorText);
    sendLabel.textContent = "Try again"; // the button invites another attempt
  } else {
    handleReply(data);
  }
}

// The server answers with a "status" that tells us what to do next
function handleReply(data) {
  missingBox.hidden = true;
  confirmBox.hidden = true;

  if (data.status === "needs_info") {
    if (data.message) {
      showError(data.message); // e.g. "Choose a time at least 2 minutes ahead"
    }
    showMissingBox(data);
  } else if (data.status === "needs_confirmation") {
    showConfirmBox(data);
  } else if (data.status === "scheduled") {
    promptInput.value = "";
    draft = null;
    showView("scheduled"); // the new call shows up in the list
  }
}

// Asks for the details the server could not find. Only those fields are shown.
function showMissingBox(data) {
  // Fill in what the server did understand
  missingInputs.contact_name.value = data.contact_name || "";
  missingInputs.contact_number.value = data.contact_number || "";
  missingInputs.message.value = data.agent_result.message || "";
  missingInputs.scheduled_time.value = "";

  for (const name in missingInputs) {
    const isMissing = data.missing_fields.includes(name);
    missingInputs[name].parentElement.hidden = !isMissing; // the parent is the <label>
  }
  missingBox.hidden = false;

  // Put the cursor in the first field that is asked for
  for (const name in missingInputs) {
    if (data.missing_fields.includes(name)) {
      missingInputs[name].focus();
      break;
    }
  }
}

// Shows what the server understood and waits for the user to say yes
function showConfirmBox(data) {
  draft = data.agent_result;
  confirmName.textContent = data.contact_name;
  confirmNumber.textContent = formatPhone(data.contact_number);
  confirmTime.textContent = formatTime(data.scheduled_time);
  confirmMessage.textContent = data.message_preview;
  confirmBox.hidden = false;
  confirmBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// "Preview call" button: send the typed text
scheduleForm.addEventListener("submit", (event) => {
  event.preventDefault(); // stay on the page instead of reloading it
  missingBox.hidden = true;
  confirmBox.hidden = true;
  draft = null;
  sendToServer(buildRequest());
});

// "Continue" button: send the typed text again, together with the details the user filled in
function sendMissingDetails() {
  // The names the server expects for each detail
  const serverNames = {
    contact_name: "confirmed_contact_name",
    contact_number: "confirmed_number",
    message: "confirmed_message",
    scheduled_time: "chosen_time",
  };

  const body = buildRequest();
  for (const name in missingInputs) {
    const input = missingInputs[name];
    if (input.parentElement.hidden || input.value.trim() === "") {
      continue; // this detail was not asked for, or was left empty
    }
    if (name === "scheduled_time") {
      body[serverNames[name]] = input.value + ":00+05:30"; // the time box has no seconds and no time zone
    } else {
      body[serverNames[name]] = input.value.trim();
    }
  }
  sendToServer(body);
}

// "Schedule call" button: tell the server that the user agrees
function sendConfirmation() {
  const body = buildRequest();
  body.confirmed = true;
  body.agent_result = draft;
  sendToServer(body);
}

continueButton.addEventListener("click", sendMissingDetails);
confirmButton.addEventListener("click", sendConfirmation);

// "Edit" button: go back to the text box
editButton.addEventListener("click", () => {
  confirmBox.hidden = true;
  draft = null;
  promptInput.focus();
});

// If the text changes, an old answer no longer matches it
promptInput.addEventListener("input", () => {
  missingBox.hidden = true;
  confirmBox.hidden = true;
  draft = null;
});

// The example buttons put their text into the text box
for (const button of document.querySelectorAll(".example")) {
  button.addEventListener("click", () => {
    promptInput.value = button.dataset.prompt;
    promptInput.focus();
  });
}


// ---------- Scheduled: the list of calls ----------

function showCallsError(text) {
  callsError.textContent = text;
  callsError.hidden = false;
}

// Gives a part of a time (month, day, ...) in Indian time. Example: part(date, { month: "short" }) gives "Oct".
function part(date, options) {
  options.timeZone = IST;
  return date.toLocaleString("en-IN", options);
}

// The month shown on a call. Calls from another year get the year too, e.g. "Jan ’25"
function monthLabel(date) {
  const month = part(date, { month: "short" });
  const year = part(date, { year: "2-digit" });
  const thisYear = part(new Date(), { year: "2-digit" });
  return year === thisYear ? month : month + " ’" + year;
}

// Fills one list (upcoming or past) with the calls
function showCalls(container, calls, isUpcoming) {
  container.textContent = ""; // remove the old rows

  if (calls.length === 0) {
    container.className = "call-list empty-state";
    container.textContent = isUpcoming ? "No upcoming calls yet." : "No past calls yet.";
    return;
  }
  container.className = "call-list";

  for (const call of calls) {
    const row = callTemplate.content.cloneNode(true); // copy the layout from the <template>
    const date = new Date(call.scheduled_time);

    row.querySelector(".call-item").classList.toggle("is-upcoming", isUpcoming);
    row.querySelector(".date-month").textContent = monthLabel(date);
    row.querySelector(".date-day").textContent = part(date, { day: "numeric" });
    row.querySelector(".contact-name").textContent = call.contact_name;
    row.querySelector(".meta-line").textContent =
      part(date, { weekday: "short", hour: "numeric", minute: "2-digit" }) + " · " + formatPhone(call.contact_number);
    row.querySelector(".message-line").textContent = call.rephrased_message || call.original_message;

    const badge = row.querySelector(".status-badge");
    badge.textContent = call.status;
    badge.classList.add(call.status); // the status decides the colour

    // Only calls that have not happened yet can be cancelled
    if (isUpcoming && call.status === "pending") {
      const cancelButton = document.createElement("button");
      cancelButton.type = "button";
      cancelButton.className = "text-button danger-button";
      cancelButton.textContent = "Cancel";
      cancelButton.addEventListener("click", () => cancelCall(call.id));
      row.querySelector(".card-actions").appendChild(cancelButton);
    }

    container.appendChild(row);
  }
}

// Asks the server for the calls of the current user
async function loadCalls() {
  callsError.hidden = true;
  try {
    const response = await fetch("/calls?user_id=" + encodeURIComponent(userIdInput.value.trim()));
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message);
    }
    showCalls(upcomingList, data.upcoming, true);
    showCalls(pastList, data.past, false);
    upcomingCount.textContent = data.upcoming.length;
    pastCount.textContent = data.past.length;
  } catch (error) {
    showCallsError("Couldn't load calls. Check that the backend is running.");
  }
}

async function cancelCall(id) {
  try {
    const response = await fetch("/calls/" + id, { method: "DELETE" });
    lastReply.textContent = JSON.stringify(await response.json().catch(() => ({})), null, 2);
    if (!response.ok) {
      throw new Error("Cancel failed");
    }
    loadCalls();
  } catch (error) {
    showCallsError("Couldn't cancel that call.");
  }
}

refreshButton.addEventListener("click", loadCalls);


// ---------- Contacts: backend check ----------

async function checkBackend() {
  try {
    const response = await fetch("/health");
    const data = await response.json();
    healthPill.textContent = data.status === "ok" ? "Backend ready" : "Backend problem";
    healthPill.classList.toggle("health-pill-live", data.status === "ok"); // green dot
  } catch (error) {
    healthPill.textContent = "Backend offline";
  }
}


// ---------- Start ----------

userNameInput.addEventListener("input", updateGreeting);
updateGreeting();
checkBackend();
