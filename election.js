/*
 * Two-class preference election prototype.
 *
 * Ballot weights are integer hundredths.
 *
 * The election quota is kept exactly:
 *
 *   quota = ballotCount / (seats + 1) + 0.01
 *
 * In hundredths:
 *
 *   quotaInHundredths =
 *       (100 * ballotCount + seats + 1) / (seats + 1)
 *
 * A vote total is compared against that rational value without
 * floating-point arithmetic.
 */

export function runElection(input) {
  validateInput(input);

  const seats = input.seats;
  const denominator = BigInt(seats + 1);

  // Numerator of the quota expressed in hundredths.
  const quotaNumerator =
    100n * BigInt(input.ballots.length) + denominator;

  const classes = input.classes.map((item) => ({ ...item }));

  const candidates = input.candidates.map((candidate) => ({
    ...candidate,
    status: "remaining",
    electionRound: null,
    surplusTransferred: false
  }));

  const candidateById = new Map(
    candidates.map((candidate) => [candidate.id, candidate])
  );

  const ballots = input.ballots.map((ballot) => ({
    id: ballot.id,
    preferences: [...ballot.preferences],
    weight: 100n,
    holder: ballot.preferences[0],
    history: [
      {
        round: 1,
        operation: "initial",
        source: null,
        destination: ballot.preferences[0],
        weightBefore: "1.00",
        weightAfter: "1.00"
      }
    ]
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

  function remainingInClass(classId) {
    return remaining().filter((c) => c.class === classId);
  }

  function classById(id) {
    return classes.find((item) => item.id === id);
  }

  function actualTotal(candidate) {
    return ballots
      .filter((ballot) => ballot.holder === candidate.id)
      .reduce((sum, ballot) => sum + ballot.weight, 0n);
  }

  /*
   * Totals and surpluses below are expressed in "scaled hundredths":
   * one hundredth of a vote corresponds to `denominator` units.
   */
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
    const whole = weight / 100n;
    const fraction = (weight % 100n).toString().padStart(2, "0");
    return `${whole}.${fraction}`;
  }

  function formatScaled(value) {
    /*
     * Exact value in votes:
     *
     * scaled value / (100 * denominator)
     */
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
      surplusExact:
        candidate.status === "elected"
          ? formatScaled(scaledSurplus(candidate))
          : null
    }));
  }

  function stopWithError(message) {
    status = "stopped";
    reason = message;
    log("stopped", { message });
  }

  function isFeasibleSelection(selected) {
    const selectedIds = new Set(selected.map((c) => c.id));

    if (selected.length > vacantSeats()) return false;

    for (const cls of classes) {
      const electedAfter =
        electedInClass(cls.id) +
        selected.filter((c) => c.class === cls.id).length;

      if (electedAfter > cls.max) return false;

      const remainingAfter = remaining().filter(
        (c) => c.class === cls.id && !selectedIds.has(c.id)
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
          "Section 18.1 would elect all remaining candidates, but " +
          "the result conflicts with the supplied class quotas."
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
        totals: currentTotals()
      });

      return;
    }

    if (elected().length === seats) {
      status = "ended";
      reason = "section-18.2";

      log("count-ended", {
        rule: "18.2",
        totals: currentTotals()
      });
    }
  }

  /*
   * Cryptographically secure random selection without modulo bias.
   * Requires a secure browser context, such as HTTPS or localhost.
   */
  function randomIndex(length) {
    if (!globalThis.crypto?.getRandomValues) {
      throw new Error(
        "Secure randomness is unavailable. Use HTTPS or localhost."
      );
    }

    const range = 2 ** 32;

    if (length < 1 || length > range) {
      throw new Error("Invalid number of options for drawing lots.");
    }

    const limit = Math.floor(range / length) * length;
    const buffer = new Uint32Array(1);

    do {
      globalThis.crypto.getRandomValues(buffer);
    } while (buffer[0] >= limit);

    return buffer[0] % length;
  }

  function drawOne(options, purpose) {
    const chosen = options[randomIndex(options.length)];

    log("lot-draw", {
      purpose,
      options: options.map((c) => c.id),
      chosen: chosen.id
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

      const tied = pool.filter(
        (candidate) => scaledTotal(candidate) === highest
      );

      let chosen;

      if (tied.length === 1) {
        chosen = tied[0];
      } else if (tied.length <= count - selected.length) {
        // All tied candidates fit: no draw is needed.
        selected.push(...tied);

        for (const candidate of tied) {
          pool.splice(pool.indexOf(candidate), 1);
        }

        continue;
      } else {
        chosen = drawOne(tied, purpose);
      }

      selected.push(chosen);
      pool.splice(pool.indexOf(chosen), 1);
    }

    return selected;
  }

  function declareQuotaCandidates() {
    if (status !== "running") return;

    const eligible = remaining().filter(reachesQuota);
    if (eligible.length === 0) return;

    const selected = [];

    for (const cls of classes) {
      const classEligible = eligible.filter(
        (candidate) => candidate.class === cls.id
      );

      const available = cls.max - electedInClass(cls.id);

      if (classEligible.length <= available) {
        selected.push(...classEligible);
      } else {
        selected.push(
          ...selectHighestWithLots(
            classEligible,
            available,
            `section 28: final place in class ${cls.id}`
          )
        );
      }
    }

    if (!isFeasibleSelection(selected)) {
      stopWithError(
        "Simultaneous quota declarations conflict with the supplied " +
        "seat or class quotas. Manual review is required."
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
      totals: currentTotals()
    });

    checkEndConditions();
  }

  function protectedCandidates() {
    const protectedIds = new Set();

    for (const cls of classes) {
      const needed = Math.max(0, cls.min - electedInClass(cls.id));
      const classRemaining = remainingInClass(cls.id);

      if (needed > 0 && classRemaining.length === needed) {
        for (const candidate of classRemaining) {
          protectedIds.add(candidate.id);
        }
      }
    }

    return protectedIds;
  }

  function preservesMinimums(group) {
    const ids = new Set(group.map((c) => c.id));

    return classes.every((cls) => {
      const availableAfter = remaining().filter(
        (c) => c.class === cls.id && !ids.has(c.id)
      ).length;

      return electedInClass(cls.id) + availableAfter >= cls.min;
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

      /*
       * Do not split a vote-total tie at the boundary.
       * Such a group cannot satisfy the strict comparison.
       */
      if (
        outside.length > 0 &&
        scaledTotal(group[group.length - 1]) === scaledTotal(outside[0])
      ) {
        continue;
      }

      if (!preservesMinimums(group)) continue;

      /*
       * The rules excerpt does not explicitly resolve an empty
       * comparison set after section 26 protection. Stop rather
       * than treating a vacuous comparison as automatically true.
       */
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
      totals: currentTotals()
    });

    checkEndConditions();
  }

  function nextRecipient(ballot) {
    return (
      ballot.preferences
        .map((id) => candidateById.get(id))
        .find((candidate) => candidate.status === "remaining") ?? null
    );
  }

  function moveBallot(ballot, destination, operation, newWeight = ballot.weight) {
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
      weightAfter: formatWeight(newWeight)
    });
  }

  function transferExcluded(group) {
    const ids = new Set(group.map((c) => c.id));

    const attached = ballots.filter((ballot) => ids.has(ballot.holder));

    const weights = [...new Set(attached.map((b) => b.weight.toString()))]
      .map((value) => BigInt(value))
      .sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));

    for (const weight of weights) {
      if (status !== "running") return;

      const pile = attached.filter((ballot) => ballot.weight === weight);

      // Determine destinations before moving any ballot in the pile.
      const transfers = pile.map((ballot) => ({
        ballot,
        recipient: nextRecipient(ballot)
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
          destination: recipient?.id ?? null
        })),
        totals: currentTotals()
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

    const source = ballots.filter((ballot) => {
      if (ballot.holder !== candidate.id) return false;

      return (
        candidate.electionRound === 1 ||
        receivedInElectionRound(ballot, candidate)
      );
    });

    const decisions = source.map((ballot) => ({
      ballot,
      recipient: nextRecipient(ballot)
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
      /*
       * Surplus is in scaled hundredths. Integer division truncates
       * to whole hundredths, without rounding up.
       */
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
      replacementWeight:
        replacementWeight === null
          ? "unchanged"
          : formatWeight(replacementWeight),
      transfers: participating.map(({ ballot, recipient }) => ({
        ballot: ballot.id,
        destination: recipient.id
      })),
      setAside: setAside.map(({ ballot }) => ballot.id),
      totals: currentTotals()
    });

    declareQuotaCandidates();
  }

  function runLaterRounds() {
    while (status === "running") {
      checkEndConditions();
      if (status !== "running") return;

      round += 1;
      log("round-start", { totals: currentTotals() });

      const fullClassCandidates = remaining().filter((candidate) => {
        const cls = classById(candidate.class);
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
          "Section 15.3 produced an empty comparison set after " +
          "section 26 protection. Manual review is required."
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

        const selected =
          tied.length === 1
            ? tied[0]
            : drawOne(tied, "section 15.4.1: equal surpluses");

        transferSurplus(selected);
        continue;
      }

      const protectedIds = protectedCandidates();
      const eligible = remaining().filter((c) => !protectedIds.has(c.id));

      if (eligible.length === 0) {
        stopWithError("No candidate is eligible for exclusion under 15.4.2.");
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
          "Only one candidate is lowest under 15.4.2; " +
          "section 15.4.3 expects at least two. Manual review is required."
        );
        return;
      }

      const selected = drawOne(tied, "section 15.4.2: lowest vote total");

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
    totals: currentTotals()
  });

  checkEndConditions();

  if (status === "running") {
    declareQuotaCandidates();
  }

  // The optional first-round zero-vote exclusion is never used.
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
      electionRound: candidate.electionRound
    })),
    unfilledSeats: vacantSeats(),
    candidates: currentTotals(),
    ballots: ballots.map((ballot) => ({
      id: ballot.id,
      preferences: ballot.preferences,
      holder: ballot.holder,
      weight: formatWeight(ballot.weight),
      history: ballot.history
    })),
    audit
  };
}

function validateInput(input) {
  if (!input || typeof input !== "object") {
    throw new Error("Input must be a JSON object.");
  }

  if (!Number.isSafeInteger(input.seats) || input.seats < 1) {
    throw new Error("seats must be a positive safe integer.");
  }

  if (!Array.isArray(input.classes) || input.classes.length !== 2) {
    throw new Error("Exactly two classes are required.");
  }

  const classIds = new Set();

  for (const cls of input.classes) {
    if (typeof cls.id !== "string" || !cls.id.trim()) {
      throw new Error("Every class must have a non-empty string ID.");
    }

    if (classIds.has(cls.id)) {
      throw new Error(`Duplicate class ID: ${cls.id}`);
    }

    classIds.add(cls.id);

    if (
      !Number.isSafeInteger(cls.min) ||
      !Number.isSafeInteger(cls.max) ||
      cls.min < 0 ||
      cls.min > cls.max ||
      cls.max > input.seats
    ) {
      throw new Error(`Invalid minimum or maximum for class ${cls.id}.`);
    }
  }

  const [a, b] = input.classes;

  if (a.min + b.min > input.seats) {
    throw new Error("Class minimums exceed the number of seats.");
  }

  if (a.max + b.max < input.seats) {
    throw new Error("Class maximums do not allow all seats to be filled.");
  }

  if (
    a.max > input.seats - b.min ||
    b.max > input.seats - a.min
  ) {
    throw new Error(
      "A class maximum would allow the other class's minimum " +
      "to become impossible."
    );
  }

  if (!Array.isArray(input.candidates) || input.candidates.length === 0) {
    throw new Error("Provide at least one candidate.");
  }

  const candidateIds = new Set();

  for (const candidate of input.candidates) {
    if (
      typeof candidate.id !== "string" ||
      !candidate.id.trim() ||
      typeof candidate.name !== "string" ||
      !candidate.name.trim()
    ) {
      throw new Error("Each candidate needs a non-empty ID and name.");
    }

    if (candidateIds.has(candidate.id)) {
      throw new Error(`Duplicate candidate ID: ${candidate.id}`);
    }

    if (!classIds.has(candidate.class)) {
      throw new Error(`Unknown class for candidate ${candidate.id}.`);
    }

    candidateIds.add(candidate.id);
  }

  if (input.candidates.length < input.seats) {
    throw new Error("There are fewer candidates than seats.");
  }

  for (const cls of input.classes) {
    const count = input.candidates.filter((c) => c.class === cls.id).length;

    if (count < cls.min) {
      throw new Error(`Not enough candidates to satisfy class ${cls.id}.`);
    }
  }

  const totalAvailable = input.classes.reduce((sum, cls) => {
    const count = input.candidates.filter((c) => c.class === cls.id).length;
    return sum + Math.min(count, cls.max);
  }, 0);

  if (totalAvailable < input.seats) {
    throw new Error(
      "The available candidates and maximum quotas cannot fill all seats."
    );
  }

  if (!Array.isArray(input.ballots) || input.ballots.length === 0) {
    throw new Error("Provide at least one validated counting ballot.");
  }

  const ballotIds = new Set();

  for (const ballot of input.ballots) {
    if (typeof ballot.id !== "string" || !ballot.id.trim()) {
      throw new Error("Every ballot needs a non-empty string ID.");
    }

    if (ballotIds.has(ballot.id)) {
      throw new Error(`Duplicate ballot ID: ${ballot.id}`);
    }

    ballotIds.add(ballot.id);

    if (!Array.isArray(ballot.preferences) || ballot.preferences.length === 0) {
      throw new Error(`Ballot ${ballot.id} has no preferences.`);
    }

    const preferencesSeen = new Set();

    for (const candidateId of ballot.preferences) {
      if (!candidateIds.has(candidateId)) {
        throw new Error(
          `Ballot ${ballot.id} references unknown candidate ${candidateId}.`
        );
      }

      if (preferencesSeen.has(candidateId)) {
        throw new Error(
          `Ballot ${ballot.id} repeats candidate ${candidateId}.`
        );
      }

      preferencesSeen.add(candidateId);
    }
  }
}
