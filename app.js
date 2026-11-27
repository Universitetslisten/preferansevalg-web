import { runElection, validateInput } from "./election.js";

const $ = (selector) => document.querySelector(selector);

const candidatesContainer = $("#candidates");
const ballotsContainer = $("#ballots");
const addBallotButton = $("#add-ballot");
const downloadButton = $("#download");
const message = $("#message");
const output = $("#output");

const FILE_FORMAT = "preference-election-input";
const FILE_VERSION = 1;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

let nextCandidateId = 1;
let nextBallotId = 1;

let preparedCandidates = null;
let lastResult = null;

function element(tag, text, className) {
  const node = document.createElement(tag);

  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;

  return node;
}

function clearResult() {
  lastResult = null;
  downloadButton.disabled = true;
  output.textContent = "Valgoppgjøret er ikke gjennomført.";
  message.textContent = "";
}

function showError(error) {
  message.textContent = error.message;
}

function readInteger(selector, label, minimum = 0) {
  const raw = $(selector).value.trim();

  if (!/^\d+$/.test(raw)) {
    throw new Error(`${label} må være et heltall.`);
  }

  const value = Number(raw);

  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} må være minst ${minimum}.`);
  }

  return value;
}

/* Klassenavn */

function className(id) {
  const name = $(id === "A" ? "#name-a" : "#name-b").value.trim();
  return name || `Klasse ${id}`;
}

function updateClassNames() {
  for (const select of document.querySelectorAll(".candidate-class")) {
    for (const option of select.options) {
      option.textContent = className(option.value);
    }
  }

  for (const label of document.querySelectorAll(".ballot-candidate-label")) {
    label.textContent =
      `${label.dataset.candidateName} ` +
      `(${className(label.dataset.candidateClass)})`;
  }
}

$("#name-a").addEventListener("input", updateClassNames);
$("#name-b").addEventListener("input", updateClassNames);

/* Kandidater */

function addCandidate(name = "", classId = "A") {
  const row = element("div", undefined, "candidate-row");
  row.dataset.candidateId = `candidate-${nextCandidateId++}`;

  const nameLabel = element("label", "Navn ");
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = name;
  nameInput.placeholder = "Kandidatens navn";
  nameInput.className = "candidate-name";
  nameLabel.append(nameInput);

  const classLabel = element("label", "Klasse ");
  const select = document.createElement("select");
  select.className = "candidate-class";

  for (const id of ["A", "B"]) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = className(id);
    select.append(option);
  }

  select.value = classId;
  classLabel.append(select);

  const remove = element("button", "Fjern");
  remove.type = "button";

  remove.addEventListener("click", () => {
    row.remove();
    clearResult();
  });

  row.append(nameLabel, classLabel, remove);
  candidatesContainer.append(row);
}

function readCandidates() {
  return [...candidatesContainer.querySelectorAll(".candidate-row")]
    .map((row) => ({
      id: row.dataset.candidateId,
      name: row.querySelector(".candidate-name").value.trim(),
      class: row.querySelector(".candidate-class").value,
    }));
}

function candidatesMatchPrepared() {
  return preparedCandidates !== null &&
    JSON.stringify(readCandidates()) === JSON.stringify(preparedCandidates);
}

/* Stemmesedler */

function prepareBallots() {
  const candidates = readCandidates();

  if (candidates.length === 0) {
    throw new Error("Legg til minst én kandidat.");
  }

  if (candidates.some((candidate) => !candidate.name)) {
    throw new Error("Alle kandidater må ha et navn.");
  }

  if (
    ballotsContainer.children.length > 0 &&
    !window.confirm(
      "Hvis du klargjør registreringen på nytt, slettes alle " +
      "registrerte stemmesedler. Vil du fortsette?"
    )
  ) {
    return;
  }

  preparedCandidates = candidates;
  ballotsContainer.replaceChildren();
  nextBallotId = 1;
  addBallotButton.disabled = false;

  clearResult();
  addBallot();

  message.textContent = "Registrering av stemmesedler er klargjort.";
}

function addBallot() {
  if (!preparedCandidates) {
    throw new Error("Klargjør registrering av stemmesedler først.");
  }

  if (!candidatesMatchPrepared()) {
    throw new Error(
      "Kandidatlisten er endret. Klargjør registreringen på nytt."
    );
  }

  const id = nextBallotId++;
  const ballot = element("div", undefined, "ballot");
  ballot.dataset.ballotId = String(id);
  ballot.append(element("h3", `Stemmeseddel ${id}`));

  for (const candidate of preparedCandidates) {
    const row = element("div", undefined, "ranking-row");
    const label = document.createElement("label");
    const input = document.createElement("input");
    const inputId = `rank-${id}-${candidate.id}`;

    label.htmlFor = inputId;
    label.className = "ballot-candidate-label";
    label.dataset.candidateName = candidate.name;
    label.dataset.candidateClass = candidate.class;
    label.textContent = `${candidate.name} (${className(candidate.class)})`;

    input.id = inputId;
    input.type = "number";
    input.min = "1";
    input.max = String(preparedCandidates.length);
    input.step = "1";
    input.placeholder = "—";
    input.className = "rank";
    input.dataset.candidateId = candidate.id;

    row.append(label, input);
    ballot.append(row);
  }

  const remove = element("button", "Fjern stemmeseddel");
  remove.type = "button";

  remove.addEventListener("click", () => {
    ballot.remove();
    clearResult();
  });

  ballot.append(remove);
  ballotsContainer.append(ballot);
}

function readBallots() {
  if (!candidatesMatchPrepared()) {
    throw new Error(
      "Kandidatlisten er endret. Klargjør registreringen på nytt."
    );
  }

  const entries = [...ballotsContainer.querySelectorAll(".ballot")];

  if (entries.length === 0) {
    throw new Error("Legg til minst én stemmeseddel.");
  }

  return entries.map((entry) => {
    const id = entry.dataset.ballotId;
    const ranked = [];

    for (const input of entry.querySelectorAll(".rank")) {
      const raw = input.value.trim();

      if (raw === "") continue;

      if (!/^\d+$/.test(raw)) {
        throw new Error(
          `Stemmeseddel ${id}: Prioriteringene må være heltall.`
        );
      }

      const rank = Number(raw);

      if (
        !Number.isSafeInteger(rank) ||
        rank < 1 ||
        rank > preparedCandidates.length
      ) {
        throw new Error(
          `Stemmeseddel ${id}: Ugyldig prioritering: ${raw}.`
        );
      }

      ranked.push({
        candidateId: input.dataset.candidateId,
        rank,
      });
    }

    if (ranked.length === 0) {
      throw new Error(
        `Stemmeseddel ${id} er blank. Registrer bare tellende stemmesedler.`
      );
    }

    ranked.sort((a, b) => a.rank - b.rank);

    for (let i = 0; i < ranked.length; i++) {
      if (ranked[i].rank !== i + 1) {
        throw new Error(
          `Stemmeseddel ${id}: Prioriteringene må begynne på 1 ` +
          "og fortsette uten hull eller gjentakelser."
        );
      }
    }

    return {
      id: `ballot-${id}`,
      preferences: ranked.map((item) => item.candidateId),
    };
  });
}

function buildElectionInput() {
  const nameA = $("#name-a").value.trim();
  const nameB = $("#name-b").value.trim();

  if (!nameA || !nameB) {
    throw new Error("Begge klassene må ha et navn.");
  }

  const seed = readInteger("#random-seed", "Startverdien");

  if (seed > 4294967295) {
    throw new Error("Startverdien kan ikke være større enn 4294967295.");
  }

  return {
    seats: readInteger("#seats", "Antall representanter", 1),
    seed,
    classes: [
      {
        id: "A",
        name: nameA,
        min: readInteger("#min-a", `Minimumskvoten for ${nameA}`),
        max: readInteger("#max-a", `Maksimumskvoten for ${nameA}`),
      },
      {
        id: "B",
        name: nameB,
        min: readInteger("#min-b", `Minimumskvoten for ${nameB}`),
        max: readInteger("#max-b", `Maksimumskvoten for ${nameB}`),
      },
    ],
    candidates: readCandidates(),
    ballots: readBallots(),
  };
}

/* Formatering av resultatet */

function formatExactAsDecimal(fraction, decimalPlaces = 6) {
  const parts = fraction.split("/");

  if (parts.length !== 2) return fraction;

  const numerator = BigInt(parts[0]);
  const denominator = BigInt(parts[1]);

  if (denominator <= 0n || numerator < 0n) return fraction;

  const scale = 10n ** BigInt(decimalPlaces);
  const scaled = (numerator * scale + denominator / 2n) / denominator;
  const whole = scaled / scale;
  const remainder = scaled % scale;

  if (remainder === 0n) return whole.toString();

  const decimals = remainder
    .toString()
    .padStart(decimalPlaces, "0")
    .replace(/0+$/, "");

  return `${whole},${decimals}`;
}

function norwegianWeight(value) {
  return typeof value === "string" ? value.replace(".", ",") : value;
}

function statusLabel(status) {
  const labels = {
    running: "pågår",
    ended: "avsluttet",
    stopped: "stoppet",
    remaining: "gjenstående",
    elected: "erklært valgt",
    excluded: "ekskludert",
  };

  return labels[status] || status;
}

function reasonLabel(reason) {
  const labels = {
    "section-18.1": "Avsluttet etter punkt 18.1.",
    "section-18.2": "Avsluttet etter punkt 18.2.",
  };

  return labels[reason] || reason;
}

function resultLabels(result) {
  const candidates = new Map(
    result.input.candidates.map((candidate) => [candidate.id, candidate])
  );

  const classes = new Map(
    result.input.classes.map((cls) => [cls.id, cls.name || cls.id])
  );

  function label(id) {
    if (id === null || id === undefined) return "Lagt til side";

    const candidate = candidates.get(id);

    if (!candidate) return String(id);

    return (
      `${candidate.name} ` +
      `(${classes.get(candidate.class) || candidate.class})`
    );
  }

  return {
    label,
    list: (ids) => ids.map(label).join(", ") || "Ingen",
  };
}

function formatCountSummary(result) {
  const { label } = resultLabels(result);

  const lines = [
    "RESULTAT",
    "========",
    "",
    `Status: ${statusLabel(result.status)}`,
    `Valgtall: ${result.quotaExact} (eksakt)`,
    `Valgtall: cirka ${formatExactAsDecimal(result.quotaExact)}`,
    `Startverdi for loddtrekning: ${result.input.seed}`,
    "",
    "Erklært valgt:",
  ];

  let found = false;

  for (const event of result.audit) {
    if (event.event === "quota-declaration" && event.elected.length > 0) {
      found = true;

      lines.push(
        `  Runde ${event.round} – oppnådde et stemmetall ` +
        "større enn eller lik valgtallet:"
      );

      for (const id of event.elected) {
        lines.push(`    - ${label(id)}`);
      }
    }

    if (
      event.event === "count-ended" &&
      event.rule === "18.1" &&
      (event.electedAtEnd || []).length > 0
    ) {
      found = true;

      lines.push(`  Runde ${event.round} – erklært valgt etter punkt 18.1:`);

      for (const id of event.electedAtEnd) {
        lines.push(`    - ${label(id)}`);
      }
    }
  }

  if (!found) {
    lines.push("  Ingen kandidater er erklært valgt.");
  }

  lines.push("");
  lines.push(`Ledige plasser: ${result.unfilledSeats}`);

  if (result.reason) {
    lines.push(`Årsak til avslutning eller stopp: ${reasonLabel(result.reason)}`);
  }

  if (result.status !== "ended") {
    lines.push("");
    lines.push(
      "Valgoppgjøret er ikke avsluttet. Dette er ikke et endelig resultat."
    );
  }

  lines.push("");
  lines.push(
    "Den nedlastbare JSON-filen inneholder det fullstendige resultatet og loggen."
  );

  return lines.join("\n");
}

function formatHumanLog(result) {
  const { label, list } = resultLabels(result);

  function addTotals(lines, totals) {
    if (!totals) return;

    lines.push("  Kandidatenes stemmetall:");

    for (const candidate of totals) {
      lines.push(
        `    - ${label(candidate.id)}: ` +
        `${norwegianWeight(candidate.actualVotes)} i tilknyttet seddelvekt; ` +
        `status: ${statusLabel(candidate.status)}`
      );

      if (candidate.status === "elected") {
        lines.push(
          "      Beregnet stemmetall: cirka " +
          formatExactAsDecimal(candidate.consideredVotesExact)
        );
      }
    }
  }

  function addTransfers(lines, transfers) {
    const counts = new Map();

    for (const transfer of transfers || []) {
      const destination = transfer.destination ?? null;
      counts.set(destination, (counts.get(destination) || 0) + 1);
    }

    if (counts.size === 0) {
      lines.push("    Ingen stemmesedler ble overført.");
      return;
    }

    for (const [destination, count] of counts) {
      const destinationLabel = destination === null
        ? "Lagt til side"
        : `Til ${label(destination)}`;

      lines.push(`    ${destinationLabel}: ${count} stemmeseddel/stemmesedler`);
    }
  }

  const lines = [
    "LOGG FOR VALGOPPGJØRET",
    "======================",
    "",
    `Tellende stemmesedler: ${result.input.ballots.length}`,
    `Representanter som skal velges: ${result.input.seats}`,
    `Valgtall: ${result.quotaExact} (eksakt)`,
    `Valgtall: cirka ${formatExactAsDecimal(result.quotaExact)}`,
    `Startverdi for loddtrekning: ${result.input.seed}`,
    "Algoritme for loddtrekning: mulberry32-v1",
    "",
  ];

  for (const event of result.audit) {
    switch (event.event) {
      case "count-started":
        lines.push("Runde 1 – første opptelling");
        addTotals(lines, event.totals);
        break;

      case "round-start":
        lines.push(`Runde ${event.round} – start`);
        addTotals(lines, event.totals);
        break;

      case "quota-declaration":
        lines.push(`Runde ${event.round} – erklæring av valgte kandidater`);
        lines.push(`  Oppnådde valgtallet: ${list(event.eligible)}`);
        lines.push(`  Erklært valgt: ${list(event.elected)}`);
        addTotals(lines, event.totals);
        break;

      case "excluded":
        lines.push(
          `Runde ${event.round} – ekskludering etter punkt ${event.rule}`
        );
        lines.push(`  ${list(event.candidates)}`);
        addTotals(lines, event.totals);
        break;

      case "excluded-pile-transferred":
        lines.push(
          `Runde ${event.round} – overføring av bunke fra ` +
          `ekskluderte kandidater, vekt ${norwegianWeight(event.weight)}`
        );
        addTransfers(lines, event.transfers);
        addTotals(lines, event.totals);
        break;

      case "surplus-transferred":
        lines.push(
          `Runde ${event.round} – overføring av overskudd fra ` +
          label(event.candidate)
        );
        lines.push(
          `  Overskudd: cirka ${formatExactAsDecimal(event.surplusExact)}`
        );

        if (event.replacementWeight === "unchanged") {
          lines.push("  De overførte stemmesedlene beholdt vekten.");
        } else {
          lines.push(
            "  Vekt per overført stemmeseddel: " +
            norwegianWeight(event.replacementWeight)
          );
        }

        addTransfers(lines, event.transfers);

        lines.push(
          `    Lagt til side: ${(event.setAside || []).length} ` +
          "stemmeseddel/stemmesedler"
        );

        addTotals(lines, event.totals);
        break;

      case "lot-draw":
        lines.push(`Runde ${event.round} – loddtrekning`);
        lines.push(`  Formål: ${event.purpose}`);
        lines.push(`  Kandidater: ${list(event.options)}`);
        lines.push(`  Trukket: ${label(event.chosen)}`);
        break;

      case "count-ended":
        lines.push(
          `Runde ${event.round} – valgoppgjøret ble avsluttet ` +
          `etter punkt ${event.rule}`
        );

        if (event.rule === "18.1") {
          lines.push(
            "  Gjenstående kandidater erklært valgt: " +
            list(event.electedAtEnd || [])
          );
        }

        addTotals(lines, event.totals);
        break;

      case "stopped":
        lines.push(`Runde ${event.round} – valgoppgjøret ble stoppet`);
        lines.push(`  ${event.message}`);
        break;

      default:
        lines.push(
          `Runde ${event.round} – ukjent logghendelse: ${event.event}`
        );
        lines.push("  Se nedlastet JSON-fil for detaljer.");
    }

    lines.push("");
  }

  lines.push(`Sluttstatus: ${statusLabel(result.status)}`);
  lines.push(`Ledige plasser: ${result.unfilledSeats}`);

  if (result.reason) {
    lines.push(`Årsak: ${reasonLabel(result.reason)}`);
  }

  return lines.join("\n");
}

/* Lagring og innlasting */

function downloadJson(data, filename) {
  const blob = new Blob(
    [JSON.stringify(data, null, 2)],
    { type: "application/json" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function validateInputFile(file) {
  if (
    !file ||
    file.format !== FILE_FORMAT ||
    file.version !== FILE_VERSION ||
    !file.election
  ) {
    throw new Error("Dette er ikke en støttet fil med valggrunnlag.");
  }

  const election = file.election;

  if (!Object.hasOwn(election, "seed")) {
    throw new Error(
      "Denne eldre filen mangler startverdi for loddtrekning. " +
      "Legg til en startverdi i valgobjektet eller opprett filen på nytt."
    );
  }

  validateInput(election);

  const classes = new Map(election.classes.map((cls) => [cls.id, cls]));

  if (
    classes.size !== 2 ||
    !classes.has("A") ||
    !classes.has("B") ||
    typeof classes.get("A").name !== "string" ||
    !classes.get("A").name.trim() ||
    typeof classes.get("B").name !== "string" ||
    !classes.get("B").name.trim()
  ) {
    throw new Error("Filen må inneholde klassene A og B med navn.");
  }

  return { election, classes };
}

function restoreElectionInput(election, classes) {
  $("#seats").value = election.seats;
  $("#random-seed").value = election.seed;

  for (const [id, suffix] of [["A", "a"], ["B", "b"]]) {
    const cls = classes.get(id);

    $(`#name-${suffix}`).value = cls.name;
    $(`#min-${suffix}`).value = cls.min;
    $(`#max-${suffix}`).value = cls.max;
  }

  candidatesContainer.replaceChildren();
  ballotsContainer.replaceChildren();

  nextCandidateId = 1;
  nextBallotId = 1;

  const candidateIdMap = new Map();

  for (const candidate of election.candidates) {
    addCandidate(candidate.name, candidate.class);

    candidateIdMap.set(
      candidate.id,
      candidatesContainer.lastElementChild.dataset.candidateId
    );
  }

  preparedCandidates = readCandidates();
  addBallotButton.disabled = false;

  for (const savedBallot of election.ballots) {
    addBallot();

    const ballot = ballotsContainer.lastElementChild;

    const inputs = new Map(
      [...ballot.querySelectorAll(".rank")].map((input) => [
        input.dataset.candidateId,
        input,
      ])
    );

    savedBallot.preferences.forEach((oldId, index) => {
      const newId = candidateIdMap.get(oldId);
      inputs.get(newId).value = String(index + 1);
    });
  }

  updateClassNames();
  clearResult();
}

/* Knapper og filvalg */

$("#generate-seed").addEventListener("click", () => {
  if (!globalThis.crypto?.getRandomValues) {
    showError(
      new Error(
        "Sikker generering av startverdi er ikke tilgjengelig. " +
        "Bruk HTTPS eller localhost."
      )
    );
    return;
  }

  const value = new Uint32Array(1);
  globalThis.crypto.getRandomValues(value);
  $("#random-seed").value = String(value[0]);

  clearResult();

  message.textContent =
    "Ny startverdi er generert. Dokumenter den før valgoppgjøret.";
});

$("#add-candidate").addEventListener("click", () => {
  addCandidate();
  clearResult();
});

$("#prepare-ballots").addEventListener("click", () => {
  try {
    prepareBallots();
  } catch (error) {
    showError(error);
  }
});

addBallotButton.addEventListener("click", () => {
  try {
    addBallot();
    clearResult();
  } catch (error) {
    showError(error);
  }
});

$("#run").addEventListener("click", () => {
  clearResult();

  try {
    lastResult = runElection(buildElectionInput());

    output.textContent =
      formatCountSummary(lastResult) + "\n\n" + formatHumanLog(lastResult);

    downloadButton.disabled = false;

    message.textContent = lastResult.status === "ended"
      ? "Valgoppgjøret er avsluttet. Kontroller resultatet og loggen."
      : `Valgoppgjøret ble stoppet: ${
          reasonLabel(lastResult.reason) || "manuell vurdering er nødvendig"
        }`;
  } catch (error) {
    showError(error);
  }
});

downloadButton.addEventListener("click", () => {
  if (lastResult) {
    downloadJson(lastResult, "valgoppgjor-resultat.json");
  }
});

$("#download-input").addEventListener("click", () => {
  try {
    const election = buildElectionInput();
    validateInput(election);

    downloadJson(
      { format: FILE_FORMAT, version: FILE_VERSION, election },
      "valggrunnlag.json"
    );

    message.textContent = "Valggrunnlaget er lastet ned.";
  } catch (error) {
    showError(error);
  }
});

$("#upload-input").addEventListener("change", async (event) => {
  const input = event.currentTarget;
  const file = input.files[0];

  if (!file) return;

  try {
    if (file.size > MAX_FILE_BYTES) {
      throw new Error("Filen er større enn 10 MB.");
    }

    let parsed;

    try {
      parsed = JSON.parse(await file.text());
    } catch {
      throw new Error("Den valgte filen inneholder ikke gyldig JSON.");
    }

    const { election, classes } = validateInputFile(parsed);

    if (!window.confirm(
      "Innlasting erstatter innstillinger, kandidater og stemmesedler " +
      "som er registrert nå. Vil du fortsette?"
    )) {
      return;
    }

    restoreElectionInput(election, classes);

    message.textContent =
      "Valggrunnlaget er lastet inn. Kontroller det før valgoppgjøret.";
  } catch (error) {
    showError(error);
  } finally {
    input.value = "";
  }
});

function invalidateResultOnEdit(event) {
  if (event.target.id !== "upload-input") {
    clearResult();
  }
}

$("main").addEventListener("input", invalidateResultOnEdit);
$("main").addEventListener("change", invalidateResultOnEdit);

/* Eksempelkandidater – erstatt disse før et faktisk valg. */

addCandidate("Alice", "A");
addCandidate("Alan", "A");
addCandidate("Bob", "B");
addCandidate("Carol", "B");
