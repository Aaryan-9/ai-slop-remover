import type { Detector } from "../types.js";
import { commentSlopDetector } from "./commentSlop.js";
import { commentedOutCodeDetector } from "./commentedOutCode.js";
import { dataAccessDetector } from "./dataAccess.js";
import { errorHandlingDetector } from "./errorHandling.js";
import { namingDetector } from "./naming.js";
import { phantomImportsDetector } from "./phantomImports.js";
import { placeholdersDetector } from "./placeholders.js";
import { swallowedErrorsDetector } from "./swallowedErrors.js";
import { utilityDuplicationDetector } from "./utilityDuplication.js";

export const detectors: Detector[] = [
  // Universal slop rules.
  commentSlopDetector,
  commentedOutCodeDetector,
  placeholdersDetector,
  phantomImportsDetector,
  swallowedErrorsDetector,
  // Repo-relative convention drift.
  errorHandlingDetector,
  dataAccessDetector,
  namingDetector,
  utilityDuplicationDetector
];
