export function terminateProcessTree(pid) {
  if (!pid || !Number.isFinite(pid)) {
    return false;
  }
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

export function isProcessAlive(pid) {
  if (!pid || !Number.isFinite(pid)) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
