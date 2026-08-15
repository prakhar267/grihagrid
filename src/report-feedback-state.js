export function reportFeedbackConcernState(savedOutcome, attemptedOutcome) {
  const savedConcern = savedOutcome === "needs_review";
  const rejectedConcern = attemptedOutcome === "needs_review";
  return {
    visible: savedConcern || rejectedConcern,
    unsaved: rejectedConcern && !savedConcern,
  };
}

export async function resolveArchivedReportFeedback({
  cachedFeedback,
  attemptedOutcome,
  readFeedback,
  normalizeFeedback,
}) {
  if (typeof readFeedback !== "function" || typeof normalizeFeedback !== "function") {
    throw new TypeError("archive feedback refresh requires read and normalize functions");
  }
  const result = await readFeedback();
  const feedback = normalizeFeedback(result?.feedback);
  return {
    feedback,
    outcome: feedback?.outcome || "",
    sections: feedback?.sections || [],
    conflict: {
      attemptedOutcome,
      hadSavedFeedback: Boolean(cachedFeedback),
    },
  };
}
