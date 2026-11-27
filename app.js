import { runElection } from "./election.js";

const input = document.querySelector("#input");
const output = document.querySelector("#output");
const downloadButton = document.querySelector("#download");

let lastResult = null;

const example = {
  seats: 2,

  classes: [
    { id: "A", min: 1, max: 1 },
    { id: "B", min: 1, max: 1 }
  ],

  candidates: [
    { id: "alice", name: "Alice", class: "A" },
    { id: "alan", name: "Alan", class: "A" },
    { id: "bob", name: "Bob", class: "B" },
    { id: "carol", name: "Carol", class: "B" }
  ],

  ballots: [
    { id: "1", preferences: ["alice", "bob", "carol"] },
    { id: "2", preferences: ["alice", "carol", "bob"] },
    { id: "3", preferences: ["alan", "bob", "carol"] },
    { id: "4", preferences: ["bob", "alice", "alan"] },
    { id: "5", preferences: ["bob", "alan", "alice"] },
    { id: "6", preferences: ["carol", "alice", "alan"] }
  ]
};

function showExample() {
  input.value = JSON.stringify(example, null, 2);
}

document.querySelector("#example").addEventListener("click", showExample);

document.querySelector("#run").addEventListener("click", () => {
  lastResult = null;
  downloadButton.disabled = true;

  try {
    const data = JSON.parse(input.value);

    // The result contains the input and audit log as well as the outcome.
    lastResult = runElection(data);

    output.textContent = JSON.stringify(lastResult, null, 2);
    downloadButton.disabled = false;
  } catch (error) {
    output.textContent = `Input or runtime error:\n${error.message}`;
  }
});

downloadButton.addEventListener("click", () => {
  if (!lastResult) return;

  const blob = new Blob(
    [JSON.stringify(lastResult, null, 2)],
    { type: "application/json" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "election-result.json";
  link.click();

  URL.revokeObjectURL(url);
});

showExample();
