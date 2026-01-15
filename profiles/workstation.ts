import { Profile } from "internal/profile";
import buildEssentials from "tasks/build-essentials/build-essentials";
import homebrew from "tasks/homebrew/homebrew";

const profile = new Profile({
  name: "Workstation",
  description: "The basic profile of my workstations",
});

profile.addTask(homebrew, buildEssentials);

export default profile;
