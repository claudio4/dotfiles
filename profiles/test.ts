import { Profile } from "internal/profile";
import usefulDirs from "tasks/useful-dirs/useful-dirs";
import wsl from "tasks/wsl/wsl";
import zsh from "tasks/zsh/zsh";

const profile = new Profile({
  name: "Test Profile",
});

profile.addTask(zsh, usefulDirs, wsl);

export default profile;
