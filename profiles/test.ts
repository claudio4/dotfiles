import { Profile } from "internal/profile";
import wsl from "tasks/wsl/wsl";
import zsh from "tasks/zsh/zsh";

const profile = new Profile({
  name: "Test Profile",
});

profile.addTask(zsh, wsl);

export default profile;
