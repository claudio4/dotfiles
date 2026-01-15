import { BaseTask, TaskSkippedError, type SkipReason } from "internal/task";
import { Profile } from "internal/profile";

/**
 * Helper function to sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Task that checks system requirements
 */
class CheckSystemTask extends BaseTask {
  id = "check-system";

  async _execute(): Promise<void> {
    this.setMessage("Checking OS compatibility...");
    await sleep(1000);

    this.setMessage("Checking available disk space...");
    await sleep(800);

    this.setMessage("Checking network connectivity...");
    await sleep(600);

    this.setMessage("System check complete");
  }
}

/**
 * Task that downloads a package
 */
class DownloadPackageTask extends BaseTask {
  constructor(
    private packageName: string,
    private checkTask: CheckSystemTask,
  ) {
    super();
  }

  id = `download-${this.packageName}`;

  async _execute(): Promise<void> {
    // Wait for system check
    await this.runDependency(this.checkTask);

    this.setMessage("Resolving package URL...");
    await sleep(500);

    this.setMessage("Starting download...");
    await sleep(800);

    // Simulate download progress
    for (let i = 25; i <= 100; i += 25) {
      this.setMessage(`Downloading... ${i}%`);
      await sleep(600);
    }

    this.setMessage("Download complete");
  }
}

/**
 * Task that installs a package
 */
class InstallPackageTask extends BaseTask {
  constructor(
    private packageName: string,
    private downloadTask: DownloadPackageTask,
  ) {
    super();
  }

  id = `install-${this.packageName}`;

  async _execute(): Promise<void> {
    // Wait for download
    await this.runDependency(this.downloadTask);

    this.setMessage("Extracting files...");
    await sleep(1200);

    this.setMessage("Copying files to destination...");
    await sleep(900);

    this.setMessage("Setting permissions...");
    await sleep(400);

    this.setMessage("Installation complete");
  }
}

/**
 * Task that configures a package
 */
class ConfigurePackageTask extends BaseTask {
  constructor(
    private packageName: string,
    private installTask: InstallPackageTask,
  ) {
    super();
  }

  id = `configure-${this.packageName}`;

  async _execute(): Promise<void> {
    // Wait for installation
    await this.runDependency(this.installTask);

    this.setMessage("Reading default configuration...");
    await sleep(500);

    this.setMessage("Applying custom settings...");
    await sleep(700);

    this.setMessage("Validating configuration...");
    await sleep(400);

    this.setMessage("Configuration applied");
  }
}

/**
 * Task that fails intentionally
 */
class FailingTask extends BaseTask {
  constructor(private checkTask: CheckSystemTask) {
    super();
  }

  id = "verify-certificates";

  async _execute(): Promise<void> {
    await this.runDependency(this.checkTask);

    this.setMessage("Loading certificate store...");
    await sleep(800);

    this.setMessage("Validating certificates...");
    await sleep(600);

    // Simulate a failure
    throw new Error("Certificate validation failed: untrusted issuer");
  }
}

/**
 * Task that depends on the failing task and will be skipped
 */
class DependsOnFailingTask extends BaseTask {
  constructor(private failingTask: FailingTask) {
    super();
  }

  id = "setup-secure-connection";

  async _execute(): Promise<void> {
    // This will throw because failingTask failed
    await this.runDependency(this.failingTask);

    this.setMessage("This should never run");
    await sleep(1000);
  }
}

/**
 * Task that conditionally skips itself
 */
class ConditionalTask extends BaseTask {
  constructor(
    private checkTask: CheckSystemTask,
    private shouldRun: boolean,
  ) {
    super();
  }

  id = "optional-feature";

  async _execute(): Promise<void> {
    await this.runDependency(this.checkTask);

    // Simulate checking if we should run
    this.setMessage("Checking if optional feature is enabled...");
    await sleep(500);

    if (!this.shouldRun) {
      const reason: SkipReason = {
        type: "condition-not-met",
        reason: "Feature is disabled in configuration",
      };
      throw new TaskSkippedError(this.id, reason);
    }

    this.setMessage("Setting up optional feature...");
    await sleep(1000);
  }
}

/**
 * Task that runs in parallel with others
 */
class ParallelTask extends BaseTask {
  constructor(
    private name: string,
    private duration: number,
    private checkTask: CheckSystemTask,
  ) {
    super();
  }

  id = `parallel-${this.name}`;

  async _execute(): Promise<void> {
    await this.runDependency(this.checkTask);

    this.setMessage("Initializing...");
    await sleep(300);

    const steps = 5;
    const stepDuration = this.duration / steps;

    for (let i = 1; i <= steps; i++) {
      this.setMessage(`Processing step ${i}/${steps}...`);
      await sleep(stepDuration);
    }

    this.setMessage("Complete");
  }
}

/**
 * Task that combines multiple dependencies
 */
class FinalVerificationTask extends BaseTask {
  constructor(private dependencies: BaseTask[]) {
    super();
  }

  id = "final-verification";

  async _execute(): Promise<void> {
    this.setMessage("Waiting for all installations...");

    // Wait for all dependencies (some might be optional/failed)
    for (const dep of this.dependencies) {
      try {
        await this.runDependency(dep, true); // Mark as optional
      } catch (err) {
        // Continue even if optional dependencies fail
      }
    }

    this.setMessage("Running system-wide verification...");
    await sleep(1500);

    this.setMessage("Checking integration...");
    await sleep(800);

    this.setMessage("All checks passed");
  }
}

const profile = new Profile({
  name: "Development Environment Setup",
  description: "Install and configure development tools and dependencies",
});

// Create tasks
const checkSystem = new CheckSystemTask();

// Node.js toolchain
const downloadNode = new DownloadPackageTask("nodejs", checkSystem);
const installNode = new InstallPackageTask("nodejs", downloadNode);
const configureNode = new ConfigurePackageTask("nodejs", installNode);

// Python toolchain
const downloadPython = new DownloadPackageTask("python", checkSystem);
const installPython = new InstallPackageTask("python", downloadPython);
const configurePython = new ConfigurePackageTask("python", installPython);

// Git
const downloadGit = new DownloadPackageTask("git", checkSystem);
const installGit = new InstallPackageTask("git", downloadGit);
const configureGit = new ConfigurePackageTask("git", installGit);

// Tasks that will fail/skip
const failingTask = new FailingTask(checkSystem);
const dependsOnFailing = new DependsOnFailingTask(failingTask);
const conditionalTask = new ConditionalTask(checkSystem, false); // Will skip

// Parallel tasks
const parallel1 = new ParallelTask("cache-warming", 2000, checkSystem);
const parallel2 = new ParallelTask("index-building", 2500, checkSystem);
const parallel3 = new ParallelTask("plugin-discovery", 1800, checkSystem);

// Final verification
const finalVerification = new FinalVerificationTask([
  configureNode,
  configurePython,
  configureGit,
  parallel1,
  parallel2,
  parallel3,
]);

// Add all tasks to profile
profile.addTask(
  checkSystem,
  downloadNode,
  installNode,
  configureNode,
  downloadPython,
  installPython,
  configurePython,
  downloadGit,
  installGit,
  configureGit,
  failingTask,
  dependsOnFailing,
  conditionalTask,
  parallel1,
  parallel2,
  parallel3,
  finalVerification,
);

export default profile;
