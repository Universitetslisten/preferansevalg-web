/*
 * Prototype for preferansevalg med to klasser.
 *
 * Stemmesedlenes vekter lagres som hele hundredeler. Valgtallet lagres
 * som en eksakt brøk når programmet avgjør om det er oppnådd.
 *
 * Samme inndata, kandidatrekkefølge, startverdi og programversjon
 * kreves for å gjenskape loddtrekningene.
 */

function createSeededGenerator(seed) {
  let state = seed >>> 0;

  return function nextUint32() {
    state = (state + 0x6D2B79F5) >>> 0;

    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

    return (value ^ (value >>> 14)) >>> 0;
  };
}

export function runElection(input) {
  validateInput(input);

  const nextRandomUint32 = createSeededGenerator(input.seed);
  const seats = input.seats;
  const denominator = BigInt(seats + 1);

  const quotaNumerator =
    100n * BigInt(input.ballots.length) + denominator;

  const classes = input.classes.map((cls) => ({ ...cls }));

  const candidates = input.candidates.map((candidate) => ({
    ...candidate,
    status: "remaining",
    electionRound: null,
    surplusTransferred: false,
  }));

  const candidateById = new Map(candidates.map((c) => [c.id, c]));

  const ballots = input.ballots.map((ballot) => ({
    id: ballot.id,
    preferences: [...ballot.preferences],
    weight: 100n,
    holder: ballot.preferences[0],
    history: [{
      round: 1,
      operation: "initial",
      source: null,
      destination: ballot.preferences[0],
      weightBefore: "1.00",
      weightAfter: "1.00",
    }],
  }));

  const audit = [];
  let round = 1;
  let status = "running";
  let reason = null;

  function log(event, details = {}) {
    audit.push({ round, event, ...details });
  }

  function remaining() {
    return candidates.filter((c) => c.status === "remaining");
  }

  function elected() {
    return candidates.filter((c) => c.status === "elected");
  }

  function vacantSeats() {
    return seats - elected().length;
  }

  function electedInClass(classId) {
    return elected().filter((c) => c.class === classId).length;
  }

  function actualTotal(candidate) {
    return ballots
      .filter((ballot) => ballot.holder === candidate.id)
      .reduce((sum, ballot) => sum + ballot.weight, 0n);
  }

  function scaledTotal(candidate) {
    const actual = actualTotal(candidate) * denominator;

    if (candidate.status === "elected") {
      return actual > quotaNumerator ? actual : quotaNumerator;
    }

    return actual;
  }

  function scaledSurplus(candidate) {
    const total = scaledTotal(candidate);

    return total > quotaNumerator
      ? total - quotaNumerator
      : 0n;
  }

  function reachesQuota(candidate) {
    return scaledTotal(candidate) >= quotaNumerator;
  }

  function formatWeight(weight) {
    return (
      `${weight / 100n}.` +
      (weight % 100n).toString().padStart(2, "0")
    );
  }

  function formatScaled(value) {
    return `${value}/${100n * denominator}`;
  }

  function currentTotals() {
    return candidates.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      class: candidate.class,
      status: candidate.status,
      actualVotes: formatWeight(actualTotal(candidate)),
      consideredVotesExact: formatScaled(scaledTotal(candidate)),
      surplusExact: candidate.status === "elected"
        ? formatScaled(scaledSurplus(candidate))
        : null,
    }));
  }

  function stopWithError(message) {
    status = "stopped";
    reason = message;
    log("stopped", { message });
  }

  function isFeasibleSelection(selected) {
    const ids = new Set(selected.map((c) => c.id));

    if (selected.length > vacantSeats()) return false;

    for (const cls of classes) {
      const electedAfter =
        electedInClass(cls.id) +
        selected.filter((c) => c.class === cls.id).length;

      if (electedAfter > cls.max) return false;

      const remainingAfter = remaining().filter(
        (c) => c.class === cls.id && !ids.has(c.id)
      ).length;

      if (electedAfter + remainingAfter < cls.min) return false;
    }

    const seatsAfter = vacantSeats() - selected.length;

    const minimumStillNeeded = classes.reduce((sum, cls) => {
      const electedAfter =
        electedInClass(cls.id) +
        selected.filter((c) => c.class === cls.id).length;

      return sum + Math.max(0, cls.min - electedAfter);
    }, 0);

    return minimumStillNeeded <= seatsAfter;
  }

  function checkEndConditions() {
    if (status !== "running") return;

    const left = remaining();

    if (left.length <= vacantSeats()) {
      if (!isFeasibleSelection(left)) {
        stopWithError(
          "Punkt 18.1 ville erklært alle gjenstående kandidater valgt, " +
          "men resultatet er i konflikt med de oppgitte klassekvotene."
        );
        return;
      }

      for (const candidate of left) {
        candidate.status = "elected";
        candidate.electionRound = round;
      }

      status = "ended";
      reason = "section-18.1";

      log("count-ended", {
        rule: "18.1",
        electedAtEnd: left.map((c) => c.id),
        unfilledSeats: vacantSeats(),
        totals: currentTotals(),
      });

      return;
    }

    if (elected().length === seats) {
      status = "ended";
      reason = "section-18.2";

      log("count-ended", {
        rule: "18.2",
        totals: currentTotals(),
      });
    }
  }

  function randomIndex(length) {
    const range = 2 ** 32;

    if (!Number.isSafeInteger(length) || length < 1 || length > range) {
      throw new Error("Ugyldig antall alternativer for loddtrekning.");
    }

    const limit = Math.floor(range / length) * length;
    let value;

    do {
      value = nextRandomUint32();
    } while (value >= limit);

    return value % length;
  }

  function drawOne(options, purpose) {
    const chosen = options[randomIndex(options.length)];

    log("lot-draw", {
      purpose,
      options: options.map((c) => c.id),
      chosen: chosen.id,
    });

    return chosen;
  }

  function selectHighestWithLots(options, count, purpose) {
    const pool = [...options];
    const selected = [];

    while (selected.length < count) {
      let highest = scaledTotal(pool[0]);

      for (const candidate of pool) {
        if (scaledTotal(candidate) > highest) {
          highest = scaledTotal(candidate);
        }
      }

      const tied = pool.filter((c) => scaledTotal(c) === highest);

      if (tied.length <= count - selected.length) {
        selected.push(...tied);

        for (const candidate of tied) {
          pool.splice(pool.indexOf(candidate), 1);
        }
      } else {
        const chosen = drawOne(tied, purpose);
        selected.push(chosen);
        pool.splice(pool.indexOf(chosen), 1);
      }
    }

    return selected;
  }

  function declareQuotaCandidates() {
    if (status !== "running") return;

    const eligible = remaining().filter(reachesQuota);

    if (eligible.length === 0) return;

    const selected = [];

    for (const cls of classes) {
      const classEligible = eligible.filter((c) => c.class === cls.id);
      const available = cls.max - electedInClass(cls.id);

      if (classEligible.length <= available) {
        selected.push(...classEligible);
      } else {
        selected.push(...selectHighestWithLots(
          classEligible,
          available,
          `Punkt 28: siste plass innenfor maksimumskvoten for klasse ${cls.id}`
        ));
      }
    }

    if (!isFeasibleSelection(selected)) {
      stopWithError(
        "Samtidig erklæring av valgte kandidater er i konflikt med " +
        "antall plasser eller klassekvotene. Manuell vurdering er nødvendig."
      );
      return;
    }

    for (const candidate of selected) {
      candidate.status = "elected";
      candidate.electionRound = round;
      candidate.surplusTransferred = false;
    }

    log("quota-declaration", {
      eligible: eligible.map((c) => c.id),
      elected: selected.map((c) => c.id),
      totals: currentTotals(),
    });

    checkEndConditions();
  }

  function protectedCandidates() {
    const ids = new Set();

    for (const cls of classes) {
      const needed = Math.max(0, cls.min - electedInClass(cls.id));
      const left = remaining().filter((c) => c.class === cls.id);

      if (needed > 0 && left.length === needed) {
        for (const candidate of left) {
          ids.add(candidate.id);
        }
      }
    }

    return ids;
  }

  function preservesMinimums(group) {
    const ids = new Set(group.map((c) => c.id));

    return classes.every((cls) => {
      const left = remaining().filter(
        (c) => c.class === cls.id && !ids.has(c.id)
      ).length;

      return electedInClass(cls.id) + left >= cls.min;
    });
  }

  function findExclusionGroup() {
    const protectedIds = protectedCandidates();

    const applicable = remaining()
      .filter((c) => !protectedIds.has(c.id))
      .sort((a, b) => {
        const left = scaledTotal(a);
        const right = scaledTotal(b);

        return left < right ? -1 : left > right ? 1 : 0;
      });

    const maximumSize = Math.min(
      applicable.length,
      remaining().length - vacantSeats()
    );

    const untransferredSurplus = elected()
      .filter((c) => !c.surplusTransferred)
      .reduce((sum, c) => sum + scaledSurplus(c), 0n);

    for (let size = maximumSize; size >= 1; size--) {
      const group = applicable.slice(0, size);
      const outside = applicable.slice(size);

      if (
        outside.length > 0 &&
        scaledTotal(group[group.length - 1]) === scaledTotal(outside[0])
      ) {
        continue;
      }

      if (!preservesMinimums(group)) continue;

      if (outside.length === 0) {
        return { unresolved: true };
      }

      const combined =
        group.reduce((sum, c) => sum + scaledTotal(c), 0n) +
        untransferredSurplus;

      if (outside.every((c) => combined < scaledTotal(c))) {
        return { group };
      }
    }

    return { group: null };
  }

  function exclude(group, rule) {
    for (const candidate of group) {
      candidate.status = "excluded";
    }

    log("excluded", {
      rule,
      candidates: group.map((c) => c.id),
      totals: currentTotals(),
    });

    checkEndConditions();
  }

  function nextRecipient(ballot) {
    return ballot.preferences
      .map((id) => candidateById.get(id))
      .find((candidate) => candidate.status === "remaining") ?? null;
  }

  function moveBallot(
    ballot,
    destination,
    operation,
    newWeight = ballot.weight
  ) {
    const source = ballot.holder;
    const oldWeight = ballot.weight;

    ballot.holder = destination;
    ballot.weight = newWeight;

    ballot.history.push({
      round,
      operation,
      source,
      destination,
      weightBefore: formatWeight(oldWeight),
      weightAfter: formatWeight(newWeight),
    });
  }

  function transferExcluded(group) {
    const ids = new Set(group.map((c) => c.id));
    const attached = ballots.filter((ballot) => ids.has(ballot.holder));

    const weights = [...new Set(attached.map((b) => b.weight.toString()))]
      .map((value) => BigInt(value))
      .sort((a, b) => a > b ? -1 : a < b ? 1 : 0);

    for (const weight of weights) {
      if (status !== "running") return;

      const pile = attached.filter((ballot) => ballot.weight === weight);

      const transfers = pile.map((ballot) => ({
        ballot,
        recipient: nextRecipient(ballot),
      }));

      for (const { ballot, recipient } of transfers) {
        moveBallot(
          ballot,
          recipient ? recipient.id : null,
          `excluded-pile-${formatWeight(weight)}`
        );
      }

      log("excluded-pile-transferred", {
        weight: formatWeight(weight),
        transfers: transfers.map(({ ballot, recipient }) => ({
          ballot: ballot.id,
          destination: recipient?.id ?? null,
        })),
        totals: currentTotals(),
      });

      declareQuotaCandidates();
    }
  }

  function receivedInElectionRound(ballot, candidate) {
    return ballot.history.some(
      (entry) =>
        entry.round === candidate.electionRound &&
        entry.destination === candidate.id
    );
  }

  function transferSurplus(candidate) {
    const surplus = scaledSurplus(candidate);

    const source = ballots.filter((ballot) =>
      ballot.holder === candidate.id &&
      (
        candidate.electionRound === 1 ||
        receivedInElectionRound(ballot, candidate)
      )
    );

    const decisions = source.map((ballot) => ({
      ballot,
      recipient: nextRecipient(ballot),
    }));

    const participating = decisions.filter((item) => item.recipient);
    const setAside = decisions.filter((item) => !item.recipient);

    const participatingWeight = participating.reduce(
      (sum, item) => sum + item.ballot.weight,
      0n
    );

    let replacementWeight = null;

    if (
      participating.length > 0 &&
      participatingWeight * denominator > surplus
    ) {
      replacementWeight =
        surplus / (denominator * BigInt(participating.length));
    }

    for (const { ballot } of setAside) {
      moveBallot(ballot, null, "surplus-set-aside");
    }

    for (const { ballot, recipient } of participating) {
      moveBallot(
        ballot,
        recipient.id,
        "surplus-transfer",
        replacementWeight ?? ballot.weight
      );
    }

    candidate.surplusTransferred = true;

    log("surplus-transferred", {
      candidate: candidate.id,
      surplusExact: formatScaled(surplus),
      replacementWeight: replacementWeight === null
        ? "unchanged"
        : formatWeight(replacementWeight),
      transfers: participating.map(({ ballot, recipient }) => ({
        ballot: ballot.id,
        destination: recipient.id,
      })),
      setAside: setAside.map(({ ballot }) => ballot.id),
      totals: currentTotals(),
    });

    declareQuotaCandidates();
  }

  function runLaterRounds() {
    while (status === "running") {
      checkEndConditions();

      if (status !== "running") return;

      round++;
      log("round-start", { totals: currentTotals() });

      const fullClassCandidates = remaining().filter((candidate) => {
        const cls = classes.find((item) => item.id === candidate.class);
        return electedInClass(cls.id) >= cls.max;
      });

      if (fullClassCandidates.length > 0) {
        exclude(fullClassCandidates, "25");

        if (status === "running") {
          transferExcluded(fullClassCandidates);
        }

        continue;
      }

      const exclusion = findExclusionGroup();

      if (exclusion.unresolved) {
        stopWithError(
          "Punkt 15.3 ga et tomt sammenligningsgrunnlag etter at " +
          "kandidater ble beskyttet etter punkt 26. " +
          "Manuell vurdering er nødvendig."
        );
        return;
      }

      if (exclusion.group) {
        exclude(exclusion.group, "15.3");

        if (status === "running") {
          transferExcluded(exclusion.group);
        }

        continue;
      }

      const surplusCandidates = elected().filter(
        (candidate) =>
          candidate.electionRound < round &&
          !candidate.surplusTransferred &&
          scaledSurplus(candidate) > 0n
      );

      if (surplusCandidates.length > 0) {
        let largest = scaledSurplus(surplusCandidates[0]);

        for (const candidate of surplusCandidates) {
          if (scaledSurplus(candidate) > largest) {
            largest = scaledSurplus(candidate);
          }
        }

        const tied = surplusCandidates.filter(
          (candidate) => scaledSurplus(candidate) === largest
        );

        const selected = tied.length === 1
          ? tied[0]
          : drawOne(tied, "Punkt 15.4.1: like store overskudd");

        transferSurplus(selected);
        continue;
      }

      const protectedIds = protectedCandidates();
      const eligible = remaining().filter((c) => !protectedIds.has(c.id));

      if (eligible.length === 0) {
        stopWithError(
          "Ingen kandidat kan ekskluderes etter punkt 15.4.2."
        );
        return;
      }

      let lowest = scaledTotal(eligible[0]);

      for (const candidate of eligible) {
        if (scaledTotal(candidate) < lowest) {
          lowest = scaledTotal(candidate);
        }
      }

      const tied = eligible.filter((c) => scaledTotal(c) === lowest);

      if (tied.length < 2) {
        stopWithError(
          "Bare én kandidat har lavest stemmetall etter punkt 15.4.2. " +
          "Punkt 15.4.3 forutsetter minst to. " +
          "Manuell vurdering er nødvendig."
        );
        return;
      }

      const selected = drawOne(
        tied,
        "Punkt 15.4.2: kandidater med lavest stemmetall"
      );

      exclude([selected], "15.4.2");

      if (status === "running") {
        transferExcluded([selected]);
      }
    }
  }

  log("count-started", {
    seats,
    ballotCount: ballots.length,
    quotaExact: formatScaled(quotaNumerator),
    seed: input.seed,
    randomAlgorithm: "mulberry32-v1",
    totals: currentTotals(),
  });

  checkEndConditions();

  if (status === "running") {
    declareQuotaCandidates();
  }

  // Muligheten til å ekskludere kandidater med null stemmer i første
  // runde benyttes ikke.
  if (status === "running") {
    runLaterRounds();
  }

  return {
    status,
    reason,
    input,
    quotaExact: formatScaled(quotaNumerator),
    elected: elected().map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      class: candidate.class,
      electionRound: candidate.electionRound,
    })),
    unfilledSeats: vacantSeats(),
    candidates: currentTotals(),
    ballots: ballots.map((ballot) => ({
      id: ballot.id,
      preferences: ballot.preferences,
      holder: ballot.holder,
      weight: formatWeight(ballot.weight),
      history: ballot.history,
    })),
    audit,
  };
}

export function validateInput(input) {
  if (!input || typeof input !== "object") {
    throw new Error("Valggrunnlaget må være et objekt.");
  }

  if (
    !Number.isSafeInteger(input.seed) ||
    input.seed < 0 ||
    input.seed > 4294967295
  ) {
    throw new Error(
      "Startverdien må være et heltall mellom 0 og 4294967295."
    );
  }

  if (!Number.isSafeInteger(input.seats) || input.seats < 1) {
    throw new Error("Antall representanter må være et positivt heltall.");
  }

  if (!Array.isArray(input.classes) || input.classes.length !== 2) {
    throw new Error("Det må oppgis nøyaktig to klasser.");
  }

  const classIds = new Set();

  for (const cls of input.classes) {
    if (!cls || typeof cls.id !== "string" || !cls.id.trim()) {
      throw new Error("Alle klasser må ha en ikke-tom klasse-ID.");
    }

    if (classIds.has(cls.id)) {
      throw new Error(`Klasse-ID-en ${cls.id} er brukt flere ganger.`);
    }

    classIds.add(cls.id);

    if (
      !Number.isSafeInteger(cls.min) ||
      !Number.isSafeInteger(cls.max) ||
      cls.min < 0 ||
      cls.min > cls.max ||
      cls.max > input.seats
    ) {
      throw new Error(
        `Ugyldig minimumskvote eller maksimumskvote for klasse ${cls.id}.`
      );
    }
  }

  const [a, b] = input.classes;

  if (a.min + b.min > input.seats) {
    throw new Error(
      "Summen av minimumskvotene er større enn antall plasser."
    );
  }

  if (a.max + b.max < input.seats) {
    throw new Error(
      "Maksimumskvotene gjør det umulig å fylle alle plassene."
    );
  }

  if (
    a.max > input.seats - b.min ||
    b.max > input.seats - a.min
  ) {
    throw new Error(
      "En maksimumskvote kan gjøre det umulig å oppfylle " +
      "den andre klassens minimumskvote."
    );
  }

  if (!Array.isArray(input.candidates) || input.candidates.length === 0) {
    throw new Error("Oppgi minst én kandidat.");
  }

  const candidateIds = new Set();

  for (const candidate of input.candidates) {
    if (
      !candidate ||
      typeof candidate.id !== "string" ||
      !candidate.id.trim() ||
      typeof candidate.name !== "string" ||
      !candidate.name.trim()
    ) {
      throw new Error("Alle kandidater må ha en ikke-tom ID og et navn.");
    }

    if (candidateIds.has(candidate.id)) {
      throw new Error(
        `Kandidat-ID-en ${candidate.id} er brukt flere ganger.`
      );
    }

    if (!classIds.has(candidate.class)) {
      throw new Error(
        `Kandidat ${candidate.id} tilhører en ukjent klasse.`
      );
    }

    candidateIds.add(candidate.id);
  }

  if (input.candidates.length < input.seats) {
    throw new Error(
      "Det er færre kandidater enn antall representanter som skal velges."
    );
  }

  for (const cls of input.classes) {
    const count = input.candidates.filter(
      (candidate) => candidate.class === cls.id
    ).length;

    if (count < cls.min) {
      throw new Error(
        `Det er ikke nok kandidater til å oppfylle minimumskvoten ` +
        `for klasse ${cls.id}.`
      );
    }
  }

  const totalAvailable = input.classes.reduce((sum, cls) => {
    const count = input.candidates.filter(
      (candidate) => candidate.class === cls.id
    ).length;

    return sum + Math.min(count, cls.max);
  }, 0);

  if (totalAvailable < input.seats) {
    throw new Error(
      "Kandidatene og maksimumskvotene gjør det umulig å fylle alle plassene."
    );
  }

  if (!Array.isArray(input.ballots) || input.ballots.length === 0) {
    throw new Error("Oppgi minst én godkjent, tellende stemmeseddel.");
  }

  const ballotIds = new Set();

  for (const ballot of input.ballots) {
    if (!ballot || typeof ballot.id !== "string" || !ballot.id.trim()) {
      throw new Error("Alle stemmesedler må ha en ikke-tom ID.");
    }

    if (ballotIds.has(ballot.id)) {
      throw new Error(
        `Stemmeseddel-ID-en ${ballot.id} er brukt flere ganger.`
      );
    }

    ballotIds.add(ballot.id);

    if (
      !Array.isArray(ballot.preferences) ||
      ballot.preferences.length === 0
    ) {
      throw new Error(
        `Stemmeseddel ${ballot.id} inneholder ingen prioriteringer.`
      );
    }

    const seen = new Set();

    for (const candidateId of ballot.preferences) {
      if (!candidateIds.has(candidateId)) {
        throw new Error(
          `Stemmeseddel ${ballot.id} viser til ukjent kandidat ${candidateId}.`
        );
      }

      if (seen.has(candidateId)) {
        throw new Error(
          `Stemmeseddel ${ballot.id} gjentar kandidat ${candidateId}.`
        );
      }

      seen.add(candidateId);
    }
  }
}
