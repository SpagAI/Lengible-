import type { SeedClass, SeedDrug } from "./types";
import * as autonomic from "./autonomic";
import * as cvs from "./cvs";
import * as bloodRespGit from "./blood-resp-git";
import * as cns from "./cns";
import * as antimicrobials from "./antimicrobials";
import * as antiparasiticAntiviral from "./antiparasitic-antiviral";
import * as cancerEndocrineTox from "./cancer-endocrine-tox";

export { SYSTEMS } from "./types";
export type { SeedClass, SeedDrug } from "./types";

const parts = [autonomic, cvs, bloodRespGit, cns, antimicrobials, antiparasiticAntiviral, cancerEndocrineTox];

export const seedClasses: SeedClass[] = parts.flatMap((p) => p.classes);
export const seedDrugs: SeedDrug[] = parts.flatMap((p) => p.drugs);

// Bump when the seed changes, so accounts can be offered the update.
export const SEED_VERSION = 1;
