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
     * @param cause - The TaskError from the failed dependency
     */
    constructor(taskId: string, cause: TaskError) {
        super(taskId, cause);
        this.message = `Task "${taskId}" failed due to dependency "${cause.taskId}": ${cause.message}`;
        this.name = "TaskDependencyError";
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
     * Flag indicating whether this task has been registered.
     * Can be checked by other tasks to determine if this task is part of the current execution.
     */
    readonly hasBeenRegistered: boolean;

    /**
     * Executes the task's work.
     * Can be called multiple times safely - the actual work only happens once.
     * Tasks should await `run()` on their dependencies within their execution logic.
     */
    run(): Promise<void>;
}

/**
 * Base implementation of the Task interface with built-in memoization.
 *
 * This abstract class handles the common task lifecycle:
 * - Registration tracking via `hasBeenRegistered`
 * - Memoization of execution results to ensure `_execute()` only runs once
 * - Safe concurrent access (multiple `run()` calls return the same promise)
 */
export abstract class BaseTask implements Task {
    /** Unique identifier for this task */
    abstract id: string;

    /** Tracks whether this task has been registered by a Profile */
    hasBeenRegistered: boolean = false;

    /**
     * Cached promise for the task execution.
     * This field pseudo-private and should only be accesed outside of the class imolementation by those who know what they are doing.
     */
    _result?: Promise<void>;

    /**
     * The actual task implementation.
     * This method is called only once, regardless of how many times `run()` is invoked.
     * Implement task dependencies by awaiting other tasks' `run()` methods here.
     * This method pseudo-private and should only be accesed outside of the class imolementation by those who know what they are doing.
     */
    abstract _execute(): Promise<void>;

    /**
     * Marks this task as registered for execution.
     * Called by a Profile during the registration phase.
     */
    register(): void {
        this.hasBeenRegistered = true;
    }

    /**
     * Executes the task (or returns the cached execution promise).
     * Thread-safe: multiple concurrent calls return the same promise.
     */
    run(): Promise<void> {
        if (!this._result) {
            this._result = this._execute().catch((err) => {
                if (err instanceof TaskError) {
                    if (err.taskId === this.id) throw err;
                    throw new TaskDependencyError(this.id, err);
                }
                throw new TaskError(this.id, err);
            });
        }
        return this._result;
    }
}
