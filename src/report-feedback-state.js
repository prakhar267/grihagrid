export function reportFeedbackConcernState(savedOutcome, attemptedOutcome) {
  const savedConcern = savedOutcome === "needs_review";
  const rejectedConcern = attemptedOutcome === "needs_review";
  return {
    visible: savedConcern || rejectedConcern,
    unsaved: rejectedConcern && !savedConcern,
  };
}
