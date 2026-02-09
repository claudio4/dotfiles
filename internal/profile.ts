import type { Task, TaskStatusListener } from "./task";

export interface ProfileConfig<O> {
  name: string;
  description?: string;
  options?: O;
}

export class Profile<O = undefined> {
  readonly name: string;
  readonly description?: string;
  // the task that will be run by the profile indexded by their id
  tasks: Map<string, Task>;
  options?: O;

  constructor(config: ProfileConfig<O>) {
    this.name = config.name;
    this.description = config.description;
    this.tasks = new Map();
    this.options = config.options;
  }

  /**
   * Adds one or more tasks to the Profile.
   * @param task The task to add.
   * @returns iteslf to allow chaining
   */
  addTask(...task: Task[]): this {
    for (const t of task) {
      this.tasks.set(t.id, t);
    }
    return this;
  }

  /**
   * Adds a listener to all tasks in the Profile.
   * @returns iteslf to allow chaining
   */
  addTaskStatusListener(listener: TaskStatusListener): this {
    for (const task of this.tasks.values()) {
      task.addStatusListener(listener);
    }
    return this;
  }

  /**
   * Registers all tasks in the Profile.
   * @returns iteslf to allow chaining
   */
  register(): this {
    for (const task of this.tasks.values()) {
      task.register();
    }
    return this;
  }

  /**
   * Removes a task from the Profile.
   * @param id the task id
   * @returns iteslf to allow chaining
   */
  removeTask(id: string): this {
    this.tasks.delete(id);
    return this;
  }
}
