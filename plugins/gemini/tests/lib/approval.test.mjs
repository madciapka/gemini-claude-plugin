import { strict as assert } from "node:assert";
import { resolveApprovalMode } from "../../scripts/lib/approval.mjs";

export default function (t) {
  t.test("default is auto_edit, no sandbox", () => {
    const r = resolveApprovalMode({});
    assert.equal(r.approvalMode, "auto_edit");
    assert.equal(r.sandbox, false);
    assert.equal(r.label, "auto_edit");
  });

  t.test("--read-only maps to plan mode and disables sandbox", () => {
    const r = resolveApprovalMode({ readOnly: true, sandbox: true });
    assert.equal(r.approvalMode, "plan");
    assert.equal(r.sandbox, false, "sandbox should be ignored under plan");
  });

  t.test("--read-only beats --yolo", () => {
    const r = resolveApprovalMode({ readOnly: true, yolo: true });
    assert.equal(r.approvalMode, "plan");
  });

  t.test("--yolo enables yolo mode", () => {
    const r = resolveApprovalMode({ yolo: true });
    assert.equal(r.approvalMode, "yolo");
  });

  t.test("--sandbox is honoured under yolo", () => {
    const r = resolveApprovalMode({ yolo: true, sandbox: true });
    assert.equal(r.sandbox, true);
  });

  t.test("kebab-case 'read-only' alias works", () => {
    const r = resolveApprovalMode({ "read-only": true });
    assert.equal(r.approvalMode, "plan");
  });
}
