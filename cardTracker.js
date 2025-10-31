/*jshint esversion:6*/

// Card object constructor
function Card() {
    this.framesDetectedCount = 0;
    this.seenThisShuffle = false;
}

// Card tracking state
var cardDetectionThreshold = 1;
var cards = {};
var cardOrder = [];
var cardPairOrders = {};

// Mode tracking
var currentMode = "showingCards";
var modeSwitchThreshold = 5;
var framesWithoutDetection = 0;
var lastCardOrder = [];
var currentShuffleMetrics = null;
var shuffleModeEntryCount = 0;

// Initialize card tracker with all 52 cards
function initializeCardTracker() {
    const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    const suits = ['S', 'H', 'D', 'C']; // Spades, Hearts, Diamonds, Clubs

    ranks.forEach(rank => {
        suits.forEach(suit => {
            const cardName = rank + suit;
            cards[cardName] = new Card();
        });
    });
    cardOrder = [];
}

// Reset card tracker state
function resetCardTracker() {
    Object.keys(cards).forEach(key => {
        cards[key].framesDetectedCount = 0;
        cards[key].seenThisShuffle = false;
    });
    cardOrder = [];
    cardPairOrders = {};
}

// Update pairwise card order tracking based on predictions
function updateCardPairOrders(predictions) {
    // For each pair of predictions
    for (var i = 0; i < predictions.length; i++) {
        for (var j = i + 1; j < predictions.length; j++) {
            const predA = predictions[i];
            const predB = predictions[j];

            const cardA = predA.class;
            const cardB = predB.class;

            // Only process if both are valid cards
            if (!cards.hasOwnProperty(cardA) || !cards.hasOwnProperty(cardB)) {
                continue;
            }

            // Get left edge of bounding boxes
            const leftEdgeA = predA.bbox.x - predA.bbox.width / 2;
            const leftEdgeB = predB.bbox.x - predB.bbox.width / 2;

            // Determine sign: positive if B is to the right of A
            const distanceForwardSign = Math.sign(leftEdgeB - leftEdgeA);

            // Skip if they're at the same position
            if (distanceForwardSign === 0) continue;

            // Initialize if needed
            if (!cardPairOrders[cardA]) cardPairOrders[cardA] = {};
            if (!cardPairOrders[cardB]) cardPairOrders[cardB] = {};

            // Update the pairwise orders
            cardPairOrders[cardA][cardB] = (cardPairOrders[cardA][cardB] || 0) + distanceForwardSign;
            cardPairOrders[cardB][cardA] = (cardPairOrders[cardB][cardA] || 0) - distanceForwardSign;
        }
    }
}

// Get all cards on one side of a card using graph traversal
function getAllCardsOnOneSideOfCard(card, signOfDistance) {
    const stackToCheck = [card];
    const checkedCards = new Set();
    const cardsOnOneSide = new Set();

    while (stackToCheck.length > 0) {
        const currentCard = stackToCheck.pop();

        if (!cardPairOrders[currentCard]) continue;

        const connectedCards = Object.keys(cardPairOrders[currentCard]).filter(
            c => !checkedCards.has(c)
        );

        for (const connectedCard of connectedCards) {
            if (Math.sign(cardPairOrders[currentCard][connectedCard]) === signOfDistance) {
                checkedCards.add(connectedCard);
                stackToCheck.push(connectedCard);
                cardsOnOneSide.add(connectedCard);
            }
        }
    }

    return Array.from(cardsOnOneSide).sort();
}

// Sort cards using pairwise comparison algorithm
function sortCardsUsingPairwiseComparisons() {
    const observedCards = Object.keys(cardPairOrders);

    if (observedCards.length === 0) {
        return [];
    }

    const scores = [];

    for (const card of observedCards) {
        const aheadScore = getAllCardsOnOneSideOfCard(card, 1).length;
        const behindScore = getAllCardsOnOneSideOfCard(card, -1).length;
        scores.push({
            card: card,
            score: behindScore - aheadScore
        });
    }

    // Sort by score ascending (most negative first = leftmost)
    scores.sort((a, b) => a.score - b.score);

    return scores.map(s => s.card);
}

// Trigger shuffle mode
function triggerShuffleMode() {
    currentMode = "shuffling";
    framesWithoutDetection = 0;
    shuffleModeEntryCount++;
}

// Exit shuffle mode and save the previous card order
function exitShuffleMode() {
    lastCardOrder = cardOrder.slice(); // Save the current cardOrder as last
    currentMode = "showingCards";
    resetCardTracker(); // Reset for the new shuffle
}

// ===== SHUFFLE QUALITY METRICS =====

// Helper: Create position mapping from before to after
// Returns: { card: afterPosition } where positions are 0-indexed
function createPositionMapping(beforeOrder, afterOrder) {
    const mapping = {};
    afterOrder.forEach((card, idx) => {
        mapping[card] = idx;
    });
    return mapping;
}

// 1) Kendall's tau distance (normalized)
// Counts inversions (pairs that are out of order)
// An inversion is when two cards swap their relative order between shuffles
// Returns: fraction in [0,1], where 0.5 ≈ uniform random
function computeKendallTau(beforeOrder, afterOrder) {
    if (beforeOrder.length < 2 || afterOrder.length < 2) return 0;

    const n = beforeOrder.length;
    const positionMap = createPositionMapping(beforeOrder, afterOrder);

    // Count how many pairs are out of order (inversions)
    let inversions = 0;
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            const cardI = beforeOrder[i];
            const cardJ = beforeOrder[j];

            // In beforeOrder, cardI comes before cardJ
            // Check if they're reversed in afterOrder
            if (positionMap[cardI] > positionMap[cardJ]) {
                inversions++;
            }
        }
    }

    // Normalize to [0,1]: divide by maximum possible inversions
    const maxInversions = n * (n - 1) / 2;
    return maxInversions > 0 ? inversions / maxInversions : 0;
}

// 2) Adjacency preservation
// Counts how many originally adjacent pairs remain adjacent in same order
// This catches simple cuts (which preserve most adjacencies) vs real shuffles
// Returns: fraction in [0,1], where 1/n ≈ uniform random
function computeAdjacencyPreservation(beforeOrder, afterOrder) {
    if (beforeOrder.length < 2) return 0;

    const n = beforeOrder.length;
    const positionMap = createPositionMapping(beforeOrder, afterOrder);

    // Count pairs that were neighbors before and remain neighbors after
    let preservedAdjacencies = 0;
    for (let i = 0; i < n - 1; i++) {
        const cardA = beforeOrder[i];
        const cardB = beforeOrder[i + 1];

        // Check if cardB is still immediately after cardA
        // (same relative order and still touching)
        if (positionMap[cardB] === positionMap[cardA] + 1) {
            preservedAdjacencies++;
        }
    }

    // Normalize: how many of the n-1 original adjacencies survived?
    return preservedAdjacencies / (n - 1);
}

// 3) Longest Increasing Subsequence (LIS) length
// Finds the longest run of cards that maintained their relative order
// High LIS = block structure remains (poorly shuffled)
// Returns: LIS length (compare to 2*sqrt(n) for random)
function computeLIS(beforeOrder, afterOrder) {
    if (beforeOrder.length === 0) return 0;

    const n = beforeOrder.length;
    const positionMap = createPositionMapping(beforeOrder, afterOrder);

    // Convert beforeOrder to sequence of positions in afterOrder
    // e.g., if card at position 0 moves to position 5, sequence[0] = 5
    const sequence = [];
    for (const card of beforeOrder) {
        sequence.push(positionMap[card]);
    }

    if (sequence.length === 0) return 0;

    // Find LIS using patience sorting algorithm (O(n log n))
    // tails[i] = smallest ending value of all increasing subsequences of length i+1
    const tails = [];
    for (const val of sequence) {
        // Binary search for where this value belongs
        let left = 0;
        let right = tails.length;

        while (left < right) {
            const mid = Math.floor((left + right) / 2);
            if (tails[mid] < val) {
                left = mid + 1;
            } else {
                right = mid;
            }
        }

        // Either extend the sequence or replace an existing value
        if (left === tails.length) {
            tails.push(val);
        } else {
            tails[left] = val;
        }
    }

    return tails.length;
}

// 4) Number of rising sequences (runs)
// Counts how many increasing runs exist when reading cards in before order
// Few runs (like 1 or 2) = block structure, many runs = well mixed
// Returns: number of runs (compare to (n+1)/2 for random)
function computeRisingSequences(beforeOrder, afterOrder) {
    if (beforeOrder.length < 2) return 1;

    const n = beforeOrder.length;
    const positionMap = createPositionMapping(beforeOrder, afterOrder);

    // Create sequence of positions in afterOrder
    const sequence = [];
    for (const card of beforeOrder) {
        sequence.push(positionMap[card]);
    }

    if (sequence.length === 0) return 0;
    if (sequence.length === 1) return 1;

    // Count runs: every time sequence decreases, we start a new run
    // e.g., [5, 7, 9, 2, 4] has 2 runs: [5,7,9] and [2,4]
    let runs = 1;
    for (let i = 1; i < sequence.length; i++) {
        if (sequence[i] <= sequence[i - 1]) {
            runs++; // Started a new run
        }
    }

    return runs;
}

// 5) Footrule distance (L1 rank displacement)
// Measures how far each card moved from its original position
// Sum of absolute position changes, normalized
// Returns: fraction in [0,1]
function computeFootrule(beforeOrder, afterOrder) {
    if (beforeOrder.length === 0) return 0;

    const n = beforeOrder.length;
    const positionMap = createPositionMapping(beforeOrder, afterOrder);

    // Sum up how far each card moved
    // e.g., card at position 2 moving to position 7 adds 5 to the sum
    let totalDisplacement = 0;
    for (let i = 0; i < n; i++) {
        const card = beforeOrder[i];
        totalDisplacement += Math.abs(positionMap[card] - i);
    }

    // Normalize by maximum possible displacement (when deck is reversed)
    const maxFootrule = Math.floor(n * n / 2);
    return maxFootrule > 0 ? totalDisplacement / maxFootrule : 0;
}

// Compute all shuffle quality metrics
// Only considers cards that appear in BOTH permutations
function computeShuffleMetrics(beforeOrder, afterOrder) {
    if (beforeOrder.length === 0 || afterOrder.length === 0) {
        return null;
    }

    // Find intersection: only cards present in both permutations
    const beforeSet = new Set(beforeOrder);
    const afterSet = new Set(afterOrder);
    const commonCards = beforeOrder.filter(card => afterSet.has(card));

    // If no common cards, can't compute metrics
    if (commonCards.length === 0) {
        return null;
    }

    // Filter both orders to only include common cards, preserving order
    const filteredBefore = beforeOrder.filter(card => afterSet.has(card));
    const filteredAfter = afterOrder.filter(card => beforeSet.has(card));

    const n = filteredBefore.length;

    // Compute all metrics on the filtered card sets
    const kendallTau = computeKendallTau(filteredBefore, filteredAfter);
    const adjacency = computeAdjacencyPreservation(filteredBefore, filteredAfter);
    const lis = computeLIS(filteredBefore, filteredAfter);
    const runs = computeRisingSequences(filteredBefore, filteredAfter);
    const footrule = computeFootrule(filteredBefore, filteredAfter);

    // Expected values for three key scenarios:
    // - Random: uniform random shuffle (what we want!)
    // - No-op: identity permutation (no shuffle)
    // - Max: maximally scrambled (reverse, alternating, etc.)

    const expectedKendallRandom = 0.5;  // Random has ~50% inversions
    const expectedKendallNoOp = 0.0;    // No-op has 0% inversions
    const expectedKendallMax = 1.0;     // Reversed has 100% inversions

    const expectedAdjacencyRandom = 1 / n;  // Random preserves ~1 adjacency
    const expectedAdjacencyNoOp = 1.0;      // No-op preserves all adjacencies
    const expectedAdjacencyMax = 0.0;       // Reversed preserves none

    const expectedLISRandom = 2 * Math.sqrt(n);  // Random LIS ≈ 2√n (Baik-Deift-Johansson)
    const expectedLISNoOp = n;                   // No-op LIS = n (entire sequence)
    const expectedLISMax = 1;                    // Reversed LIS = 1 (singleton)

    const expectedRunsRandom = (n + 1) / 2;  // Random has ≈ n/2 runs
    const expectedRunsNoOp = 1;              // No-op has 1 run
    const expectedRunsMax = n;               // Alternating has n runs

    const expectedFootruleRandom = 1/3;  // Random displacement ≈ 1/3
    const expectedFootruleNoOp = 0.0;    // No-op has 0 displacement
    const expectedFootruleMax = 1.0;     // Reversed has max displacement

    // Normalize scores: score of 1.0 = close to random (good!)
    //                   score of 0.0 = close to no-op OR max-scramble (both bad!)
    // Formula: 1 - |actual - expected_random| / max_deviation_from_random

    // Kendall tau normalization
    const kendallDeviation = Math.max(
        Math.abs(expectedKendallRandom - expectedKendallNoOp),
        Math.abs(expectedKendallRandom - expectedKendallMax)
    );
    const normalizedKendall = 1 - Math.abs(kendallTau - expectedKendallRandom) / kendallDeviation;

    // Adjacency normalization
    const adjacencyDeviation = Math.max(
        Math.abs(expectedAdjacencyRandom - expectedAdjacencyNoOp),
        Math.abs(expectedAdjacencyRandom - expectedAdjacencyMax)
    );
    const normalizedAdjacency = 1 - Math.abs(adjacency - expectedAdjacencyRandom) / adjacencyDeviation;

    // LIS normalization
    const lisDeviation = Math.max(
        Math.abs(expectedLISRandom - expectedLISNoOp),
        Math.abs(expectedLISRandom - expectedLISMax)
    );
    const normalizedLIS = 1 - Math.abs(lis - expectedLISRandom) / lisDeviation;

    // Runs normalization
    const runsDeviation = Math.max(
        Math.abs(expectedRunsRandom - expectedRunsNoOp),
        Math.abs(expectedRunsRandom - expectedRunsMax)
    );
    const normalizedRuns = 1 - Math.abs(runs - expectedRunsRandom) / runsDeviation;

    // Footrule normalization
    const footruleDeviation = Math.max(
        Math.abs(expectedFootruleRandom - expectedFootruleNoOp),
        Math.abs(expectedFootruleRandom - expectedFootruleMax)
    );
    const normalizedFootrule = 1 - Math.abs(footrule - expectedFootruleRandom) / footruleDeviation;

    // Calculate overall shuffle randomness score
    // Simple average of all 5 normalized metrics
    // 1.0 = perfect shuffle, 0.0 = no shuffle or too scrambled
    const overallScore = (
        normalizedKendall +
        normalizedAdjacency +
        normalizedLIS +
        normalizedRuns +
        normalizedFootrule
    ) / 5;

    return {
        kendallTau: kendallTau,
        adjacencyPreservation: adjacency,
        lisLength: lis,
        risingSequences: runs,
        footrule: footrule,
        deckSize: n,
        expected: {
            kendallTau: expectedKendallRandom,
            adjacencyPreservation: expectedAdjacencyRandom,
            lisLength: expectedLISRandom,
            risingSequences: expectedRunsRandom
        },
        normalized: {
            kendallTau: normalizedKendall,
            adjacencyPreservation: normalizedAdjacency,
            lisLength: normalizedLIS,
            risingSequences: normalizedRuns,
            footrule: normalizedFootrule
        },
        overallScore: overallScore
    };
}

// Update shuffle metrics by comparing last and current card order
function updateShuffleMetrics() {
    if (lastCardOrder.length > 0 && cardOrder.length > 0) {
        currentShuffleMetrics = computeShuffleMetrics(lastCardOrder, cardOrder);
    } else {
        currentShuffleMetrics = null;
    }
}
