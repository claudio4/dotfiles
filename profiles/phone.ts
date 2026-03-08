import { Profile } from "internal/profile";
import bash from "tasks/bash/bash";
import basicTools from "tasks/basic-tools/basic-tools";
import fish from "tasks/fish/fish";
import git from "tasks/git/git";
import modernUtils from "tasks/modern-utils/modern-utils";
import neovim from "tasks/neovim/neovim";
import tmux from "tasks/tmux/tmux";
import zsh from "tasks/zsh/zsh";

const profile = new Profile({
  name: "Phone",
  description: "THe profile for Termux in my phone",
});

profile.addTask(git, bash, basicTools, fish, neovim, modernUtils, tmux, zsh);

export default profile;
