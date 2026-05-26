import { FEATURES } from "../config/features.server";

// Client component — receives isEnabled as a prop passed from loader
export function GamificationPanel({ isEnabled }: { isEnabled: boolean }) {
  if (!isEnabled) return null;

  return (
    <div style={{ display: "none" }} data-testid="gamification-panel-debug">
      {/* Future: loyalty progress, badge previews, streak tracker */}
      {/* Not shown until Gamification Foundation B is approved */}
    </div>
  );
}
