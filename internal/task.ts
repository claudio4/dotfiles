/**
 * Represents the current state of a task
 */
export enum TaskStatus {
  /** Task has not been registered */
  Unregistered = "unregistered",
  /** Task has not started yet */
  Pending = "pending",
  /** Task is waiting for a dependency to complete */
  Waiting = "waiting",
  /** Task is currently running */
  Running = "running",
  /** Task completed successfully */
  Completed = "completed",
  /** Task was skipped (dependency not registered or explicit skip) */
  Skipped = "skipped",
  /** Task failed during execution */
  Failed = "failed",
}

/**
 * Reason why a task was skipped
 */
export type SkipReason =
  | { type: "dependency-not-registered"; dependency: string }
  | { type: "dependency-failed"; dependency: string }
  | { type: "explicit"; reason: string }
  | { type: "condition-not-met"; reason: string };

/**
 * Information about a task's execution
 */
export interface TaskStatusInfo {
  id: string;
  status: TaskStatus;
  skipReason?: SkipReason;
  error?: Error;
  startTime?: number;
  endTime?: number;
  message?: string;
}

/**
 * Callback for task status changes
 */
export type TaskStatusListener = (info: TaskStatusInfo) => void;

/**
 * Error thrown when a task fails during execution.
 * Wraps the original error and adds the task ID for better error tracking.
 */
export class TaskError extends Error {
  /**
   * Creates a new TaskError.
   * @param taskId - The unique identifier of the task that failed
   * @param cause - The original error that caused the task to fail
   */
  constructor(
    public readonly taskId: string,
    cause: unknown,
  ) {
    const message =
      cause instanceof Error ? `Task "${taskId}" failed: ${cause.message}` : `Task "${taskId}" failed: ${cause}`;
    super(message, { cause });
    this.name = "TaskError";
  }
}

/**
 * Error thrown when a task fails because one of its dependencies failed.
 */
export class TaskDependencyError extends TaskError {
  /**
   * Creates a new TaskDependencyError.
   * @param taskId - The unique identifier of the task that failed
   * @param dependencyId - The ID of the failed dependency
   * @param cause - The TaskError from the failed dependency
   */
  constructor(
    taskId: string,
    public readonly dependencyId: string,
    cause: TaskError,
  ) {
    super(taskId, cause);
    this.message = `Task "${taskId}" failed due to dependency "${dependencyId}": ${cause.message}`;
    this.name = "TaskDependencyError";
  }
}

/**
 * Error thrown when a task is skipped
 */
export class TaskSkippedError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly skipReason: SkipReason,
  ) {
    super(`Task "${taskId}" was skipped`);
    this.name = "TaskSkippedError";
  }
}

/**
 * Tasks are the fundamental units of work in the dotfile manager. A Profile
 * (an aggregation and configuration of tasks) follows a two-phase execution model:
 *
 * 1. **Registration Phase**: The Profile calls `register()` on all tasks it will use.
 *    This marks tasks as intended to run without executing them yet.
 *
 * 2. **Execution Phase**: The Profile runs all registered tasks concurrently by calling
 *    `run()` on each. Tasks manage their own dependencies by awaiting the `run()` method
 *    of their dependencies within their own `run()` implementation. Tasks can optionally
 *    check `hasBeenRegistered` to detect if a dependency is meant to run.
 */
export interface Task {
  /** Unique identifier for this task */
  readonly id: string;

  /**
   * Marks this task as registered for execution by a Profile.
   * Called during the registration phase before any tasks run.
   */
  register(): void;

  /**
   * Current status of the task
   */
  readonly status: TaskStatus;

  /**
   * Executes the task's work.
   * Can be called multiple times safely - the actual work only happens once.
   * Tasks should await `run()` on their dependencies within their execution logic.
   */
  run(): Promise<void>;

  /**
   * Get current task information
   */
  getInfo(): TaskStatusInfo;

  /**
   * Add a listener to be notified of status changes
   */
  addStatusListener(listener: TaskStatusListener): void;

  /**
   * Remove a listener from being notified of status changes
   * @returns true if the listener was removed, false if it was not found
   */
  removeStatusListener(listener: TaskStatusListener): boolean;

  /**
   * Optional settings for the task. They are task dependant.
   */
  options?: Record<string, any>;
}

/**
 * Base implementation of the Task interface with built-in memoization and status tracking.
 *
 * This abstract class handles the common task lifecycle:
 * - Registration tracking via `hasBeenRegistered`
 * - Status tracking and reporting
 * - Memoization of execution results to ensure `_execute()` only runs once
 * - Safe concurrent access (multiple `run()` calls return the same promise)
 */
export abstract class BaseTask implements Task {
  /** Unique identifier for this task */
  abstract id: string;

  /** Current status of the task */
  private _status: TaskStatus = TaskStatus.Unregistered;

  /** Reason for skipping, if applicable */
  private _skipReason?: SkipReason;

  /** Error that occurred during execution, if any */
  private _error?: Error;

  /** Start time of execution */
  private _startTime?: number;

  /** End time of execution */
  private _endTime?: number;

  /** Optional status message */
  private _message?: string;

  protected statusListeners: TaskStatusListener[] = [];

  /**
   * Cached promise for the task execution.
   * This field is pseudo-private and should only be accessed outside of the class implementation by those who know what they are doing.
   */
  _result?: Promise<void>;

  /**
   * The actual task implementation.
   * This method is called only once, regardless of how many times `run()` is invoked.
   * Implement task dependencies by awaiting other tasks' `run()` methods here.
   * This method is pseudo-private and should only be accessed outside of the class implementation by those who know what they are doing.
   */
  abstract _execute(): Promise<void>;

  /**
   * Adds a status listener to the task.
   */
  addStatusListener(listener: TaskStatusListener): void {
    this.statusListeners.push(listener);
  }

  /**
   * Removes a status listener from the task.
   * @returns true if the listener was removed, false if it was not found
   */
  removeStatusListener(listener: TaskStatusListener): boolean {
    const index = this.statusListeners.indexOf(listener);
    if (index === -1) return false;
    this.statusListeners.splice(index, 1);
    return true;
  }

  /**
   * Marks this task as registered for execution.
   * Called by a Profile during the registration phase.
   */
  register(): void {
    if (this.status === TaskStatus.Unregistered) {
      this.updateStatus(TaskStatus.Pending);
    }
  }

  /**
   * Get the current status
   */
  get status(): TaskStatus {
    return this._status;
  }

  /**
   * Update the task status and notify listeners
   */
  protected updateStatus(status: TaskStatus, message?: string): void {
    this._status = status;
    if (message) this._message = message;

    if (status === TaskStatus.Running && !this._startTime) {
      this._startTime = Date.now();
    } else if (
      (status === TaskStatus.Completed || status === TaskStatus.Failed || status === TaskStatus.Skipped) &&
      !this._endTime
    ) {
      this._endTime = Date.now();
    }

    this.notifyStatusChange();
  }

  /**
   * Mark this task as skipped with a reason
   */
  protected skip(reason: SkipReason): void {
    this._skipReason = reason;
    this.updateStatus(TaskStatus.Skipped);
  }

  /**
   * Set a status message without changing the status
   */
  protected setMessage(message: string): void {
    this._message = message;
    this.notifyStatusChange();
  }

  /**
   * Notify listeners of status change
   */
  private notifyStatusChange(): void {
    this.statusListeners.forEach((listener) => listener(this.getInfo()));
  }

  /**
   * Get current task information
   */
  getInfo(): TaskStatusInfo {
    return {
      id: this.id,
      status: this._status,
      skipReason: this._skipReason,
      error: this._error,
      startTime: this._startTime,
      endTime: this._endTime,
      message: this._message,
    };
  }

  /**
   * Executes the task (or returns the cached execution promise).
   * Thread-safe: multiple concurrent calls return the same promise.
   */
  run(): Promise<void> {
    if (!this._result) {
      this._result = this._runInternal();
    }
    return this._result;
  }

  private async _runInternal(): Promise<void> {
    try {
      this.updateStatus(TaskStatus.Running);
      await this._execute();
      this.updateStatus(TaskStatus.Completed);
    } catch (err) {
      if (err instanceof TaskSkippedError) {
        // Task was explicitly skipped
        this._skipReason = err.skipReason;
        this.updateStatus(TaskStatus.Skipped);
        throw err;
      }

      if (err instanceof TaskError) {
        if (err.taskId === this.id) {
          this._error = err;
          this.updateStatus(TaskStatus.Failed);
          throw err;
        }

        let dErr;
        if (err instanceof TaskDependencyError) {
          dErr = new TaskDependencyError(this.id, err.dependencyId, err);
        } else {
          dErr = new TaskDependencyError(this.id, err.taskId, err);
        }
        this._error = dErr;
        this.updateStatus(TaskStatus.Failed);
        throw dErr;
      }

      // Wrap unknown errors
      const taskError = new TaskError(this.id, err);
      this._error = taskError;
      this.updateStatus(TaskStatus.Failed);
      throw taskError;
    }
  }

  /**
   * Helper to run a dependency and handle skip/failure scenarios
   */
  protected async runDependency(task: Task, optional: boolean = false): Promise<void> {
    // Check if dependency was registered
    if (!optional && task.status === TaskStatus.Unregistered) {
      const reason: SkipReason = {
        type: "dependency-not-registered",
        dependency: task.id,
      };
      throw new TaskSkippedError(this.id, reason);
    }

    try {
      this.updateStatus(TaskStatus.Waiting, "Waiting for task " + task.id);
      await task.run();
    } catch (err) {
      if (err instanceof TaskSkippedError && optional) {
        // Optional dependency was skipped, we can continue
        return;
      }

      if (err instanceof TaskError) {
        throw new TaskDependencyError(this.id, task.id, err);
      }

      throw err;
    } finally {
      this.updateStatus(TaskStatus.Running);
    }
  }
}

export async function isTaskRegistered(taskId: string): Promise<boolean> {
  try {
    const module = await import(`tasks/${taskId}.ts`);
    if (!module?.default?.getInfo) return false;
    return module.default.getInfo().status !== TaskStatus.Unregistered;
  } catch (err) {
    return false;
  }
}
