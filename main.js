/*jshint esversion:6*/

$(function () {
    const { InferenceEngine, CVImage } = inferencejs;
    const inferEngine = new InferenceEngine();

    const video = $("video")[0];

    var workerId;
    var cameraMode = "environment"; // or "user"
    var inferencePaused = false;

    // Initialize the card tracker
    initializeCardTracker();

    // Try Again button handler
    $("#try-again-button").click(function () {
        lastCardOrder = [];
        currentShuffleMetrics = null;
        shuffleModeEntryCount = 0;
        inferencePaused = false;
        resetCardTracker();
        updateCardOrderDisplay();
        updateShuffleMetricsDisplay();
        updateStatusMessage();
    });

    const startVideoStreamPromise = navigator.mediaDevices
        .getUserMedia({ audio: false, video: { facingMode: cameraMode } })
        .then(function (stream) {
            return new Promise(function (resolve) {
                video.srcObject = stream;
                video.onloadeddata = function () {
                    video.play();
                    resolve();
                };
            });
        });

    const loadModelPromise = new Promise(function (resolve, reject) {
        inferEngine
            .startWorker("shufflescore-4xtyt", "9", "rf_yc1vQDMLb7VPAedUMOLq8kwo5gT2")
            .then(function (id) {
                workerId = id;
                resolve();
            })
            .catch(reject);
    });

    Promise.all([startVideoStreamPromise, loadModelPromise]).then(function () {
        $("body").removeClass("loading");
        resizeCanvas();
        detectFrame();
    });

    var canvas, ctx;
    const font = "16px sans-serif";

    function videoDimensions(video) {
        // Ratio of the video's intrisic dimensions
        var videoRatio = video.videoWidth / video.videoHeight;

        // The width and height of the video element
        var width = video.offsetWidth,
            height = video.offsetHeight;

        // The ratio of the element's width to its height
        var elementRatio = width / height;

        // If the video element is short and wide
        if (elementRatio > videoRatio) {
            width = height * videoRatio;
        } else {
            // It must be tall and thin, or exactly equal to the original ratio
            height = width / videoRatio;
        }

        return { width: width, height: height };
    }

    $(window).resize(function () {
        resizeCanvas();
    });

    const resizeCanvas = function () {
        $("canvas").remove();

        canvas = $("<canvas/>");

        ctx = canvas[0].getContext("2d");

        var dimensions = videoDimensions(video);

        console.log(
            video.videoWidth,
            video.videoHeight,
            video.offsetWidth,
            video.offsetHeight,
            dimensions
        );

        canvas[0].width = video.videoWidth;
        canvas[0].height = video.videoHeight;

        canvas.css({
            width: dimensions.width,
            height: dimensions.height,
            left: ($(window).width() - dimensions.width) / 2,
            top: ($(window).height() - dimensions.height) / 2
        });

        $("body").append(canvas);
    };

    const updateCardOrderDisplay = function () {
        // Only show card order if cards have been detected
        if (cardOrder.length > 0) {
            const displayText = "Current card permutation: " + cardOrder.join(", ");
            $("#card-order").text(displayText).addClass("visible");
        } else {
            $("#card-order").text("").removeClass("visible");
        }

        // Only show last card order if it exists
        if (lastCardOrder.length > 0) {
            const lastOrderText = "Last card permutation: " + lastCardOrder.join(", ");
            $("#last-card-order").text(lastOrderText).addClass("visible");
        } else {
            $("#last-card-order").text("").removeClass("visible");
        }
    };

    const updateDebugInfo = function () {
        const debugText = "Mode: " + currentMode + " | Frames since detection: " + framesWithoutDetection + " | Cards found: " + cardOrder.length;
        $("#debug-info").text(debugText);
    };

    const updateStatusMessage = function () {
        if (inferencePaused) {
            $("#status-message").text("").addClass("hidden");
        } else if (currentMode === "shuffling") {
            $("#status-message").text("Shuffle away!").removeClass("hidden");
        } else {
            $("#status-message").text("Show your cards to the camera, slowly").removeClass("hidden");
        }
    };

    const updateShuffleMetricsDisplay = function () {
        if (!currentShuffleMetrics) {
            $("#shuffle-metrics").text("").removeClass("visible");
            $("#overall-score").text("");
            $("#flavor-text").text("");
            $("#try-again-button").hide();
            return;
        }

        const m = currentShuffleMetrics;

        // Transform score to penalize bad shuffles and account for detector noise
        const score = m.overallScore;
        // Step 1: Subtract 0.15 threshold, floor at 0
        let adjustedScore = Math.max(0, score - 0.15);
        // Step 2: Renormalize to [0,1] (max possible is now 0.85)
        adjustedScore = adjustedScore / 0.85;
        // Step 3: Square it to further penalize poor shuffles
        adjustedScore = adjustedScore * adjustedScore;
        // Step 4: Convert to 0-100 integer
        const displayScore = Math.round(adjustedScore * 100);

        // Determine color and flavor text based on final curved score
        let color, flavorText;

        if (displayScore >= 90) {
            color = "#4CAF50"; // Green
            flavorText = "Wow! You're an excellent shuffler!";
        } else if (displayScore >= 70) {
            color = "#8BC34A"; // Light green
            flavorText = "Perfectly adequate.";
        } else if (displayScore >= 50) {
            color = "#FFC107"; // Yellow
            flavorText = "I'm not convinced.";
        } else if (displayScore >= 25) {
            color = "#FF9800"; // Orange
            flavorText = "Just let me do it, hand over the deck <span style='font-style: normal;'>🙄</span>";
        } else {
            color = "#F44336"; // Red
            flavorText = "Uh. You're supposed to *mix them up*";
        }

        $("#overall-score").text(displayScore).css("color", color);
        $("#flavor-text").html(flavorText);
        $("#try-again-button").show();

        // Display detailed metrics below
        const lines = [
            "Shuffle Quality Metrics:",
            "Kendall τ: " + m.kendallTau.toFixed(3) + " (exp: " + m.expected.kendallTau.toFixed(3) + ") [norm: " + m.normalized.kendallTau.toFixed(2) + "]",
            "Adjacency: " + m.adjacencyPreservation.toFixed(3) + " (exp: " + m.expected.adjacencyPreservation.toFixed(3) + ") [norm: " + m.normalized.adjacencyPreservation.toFixed(2) + "]",
            "LIS: " + m.lisLength + " (exp: " + m.expected.lisLength.toFixed(1) + ") [norm: " + m.normalized.lisLength.toFixed(2) + "]",
            "Runs: " + m.risingSequences + " (exp: " + m.expected.risingSequences.toFixed(1) + ") [norm: " + m.normalized.risingSequences.toFixed(2) + "]",
        ];

        $("#shuffle-metrics").html(lines.join("<br>")).addClass("visible");
    };

    var prevTime;
    var pastFrameTimes = [];
    const detectFrame = function () {
        if (!workerId) return requestAnimationFrame(detectFrame);

        // Skip inference if paused
        if (inferencePaused) {
            return requestAnimationFrame(detectFrame);
        }

        const image = new CVImage(video);
        inferEngine
            .infer(workerId, image)
            .then(function (predictions) {
                requestAnimationFrame(detectFrame);

                // Update pairwise card order tracking
                updateCardPairOrders(predictions);

                // Check if any cards were detected this frame
                var cardsDetectedThisFrame = predictions.length > 0;

                // Track detected cards and mark as seen when they cross threshold
                var cardAddedThisFrame = false;
                predictions.forEach(function (prediction) {
                    const cardClass = prediction.class;
                    if (cards.hasOwnProperty(cardClass)) {
                        cards[cardClass].framesDetectedCount++;

                        // Check if card has crossed detection threshold
                        if (cards[cardClass].framesDetectedCount > cardDetectionThreshold && !cards[cardClass].seenThisShuffle) {
                            cards[cardClass].seenThisShuffle = true;
                            cardAddedThisFrame = true;
                        }
                    }
                });

                // Update cardOrder based on sorted permutation of seen cards
                const sortedPermutation = sortCardsUsingPairwiseComparisons();
                cardOrder = sortedPermutation.filter(card => cards[card] && cards[card].seenThisShuffle);

                // Mode switching logic
                if (cardsDetectedThisFrame) {
                    framesWithoutDetection = 0;
                } else {
                    framesWithoutDetection++;
                }

                // Switch to shuffling mode if no cards detected for threshold frames
                if (currentMode === "showingCards" && cardOrder.length > 0 && framesWithoutDetection >= modeSwitchThreshold) {
                    triggerShuffleMode();

                    // Check if this is the second time entering shuffle mode
                    if (shuffleModeEntryCount >= 2) {
                        // Compute and display the score, then pause inference
                        updateShuffleMetrics();
                        updateShuffleMetricsDisplay();
                        inferencePaused = true;
                    }
                }

                // Switch back to showingCards mode when any cards are detected during shuffling
                if (currentMode === "shuffling" && cardsDetectedThisFrame) {
                    exitShuffleMode();
                }

                // Update the card order display
                updateCardOrderDisplay();

                // Update shuffle metrics (but only show if on second shuffle)
                if (shuffleModeEntryCount < 2) {
                    updateShuffleMetrics();
                    // Don't display metrics yet
                    $("#shuffle-metrics").text("").removeClass("visible");
                    $("#overall-score").text("");
                    $("#flavor-text").text("");
                    $("#try-again-button").hide();
                }

                // Update status message
                updateStatusMessage();

                // Update debug info
                updateDebugInfo();

                if (prevTime) {
                    pastFrameTimes.push(Date.now() - prevTime);
                    if (pastFrameTimes.length > 30) pastFrameTimes.shift();

                    var total = 0;
                    _.each(pastFrameTimes, function (t) {
                        total += t / 1000;
                    });

                    var fps = pastFrameTimes.length / total;
                    $("#fps").text(Math.round(fps));
                }
                prevTime = Date.now();
            })
            .catch(function (e) {
                console.log("CAUGHT", e);
                requestAnimationFrame(detectFrame);
            });
    };
});
