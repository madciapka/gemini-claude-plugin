// Maps user-facing flags into Gemini's approval-mode + sandbox settings.
// --read-only beats --yolo (safety > convenience). --sandbox is honored under
// auto_edit/yolo but ignored under plan since plan is already non-writing.
export function resolveApprovalMode(options = {}) {
  const readOnly = Boolean(options.readOnly ?? options["read-only"]);
  if (readOnly) {
    return { approvalMode: "plan", sandbox: false, label: "read-only" };
  }
  if (options.yolo) {
    return { approvalMode: "yolo", sandbox: Boolean(options.sandbox), label: "yolo" };
  }
  return { approvalMode: "auto_edit", sandbox: Boolean(options.sandbox), label: "auto_edit" };
}
