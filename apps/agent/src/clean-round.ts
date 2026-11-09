import { canonicalDeliveryJson, type FrozenDeliveryBundleDto, CleanBuildReport, SourceExportManifest, type VerificationEvidenceBinding } from '@atoms/contracts/delivery';
import { seal } from './delivery-files.js';
type CleanBuildReportDto = ReturnType<typeof CleanBuildReport.parse>;
type SourceExportManifestDto = ReturnType<typeof SourceExportManifest.parse>;
type Evidence = ReturnType<typeof VerificationEvidenceBinding.parse>;
/** Existing strict report has one final clean pointer; previous rounds stay immutable evidence. */
export function namespaceCleanRound(clean: CleanBuildReportDto, evidence: Evidence[], round: number) {
    const prefix = 'clean_round_' + round;
    const ids = new Map(evidence.map(e => [e.id, prefix + '_' + e.id]));
    const remap = (list: string[]) => list.map(id => { const value = ids.get(id); if (!value)
        throw new Error('Clean evidence reference missing'); return value; });
    return { prefix, evidence: evidence.map(e => ({ ...e, id: ids.get(e.id)!, path: 'evidence/' + prefix + '/' + e.path.slice('evidence/'.length) })), clean: seal({ ...clean, stages: Object.fromEntries(Object.entries(clean.stages).map(([k, v]) => [k, { ...v, evidenceIds: remap(v.evidenceIds) }])) as CleanBuildReportDto['stages'], caseResults: clean.caseResults.map(c => ({ ...c, evidenceIds: remap(c.evidenceIds) })) }) };
}
export function cleanBehaviorFailures(clean: CleanBuildReportDto, exported: SourceExportManifestDto, bundle: FrozenDeliveryBundleDto) {
    const sound = Object.values(clean.stages).every(s => s.status === 'passed') && clean.sourceBeforeHash === clean.sourceAfterHash && clean.sourceBeforeHash === exported.sourceSnapshotHash && clean.archiveHash === exported.archive.sha256 && clean.exportManifestHash === exported.hash && clean.bindingHash === bundle.binding.hash && clean.toolchainId === bundle.binding.toolchain.id && clean.lockfileHash === bundle.binding.toolchain.lockfileHash && Boolean(clean.distHash);
    if (!sound)
        return null;
    const required = new Set(bundle.plan.coverage.filter(c => bundle.spec.criteria.find(s => s.id === c.criterionId)?.required).flatMap(c => c.caseIds));
    return clean.caseResults.filter(c => required.has(c.caseId) && c.status === 'failed');
}
