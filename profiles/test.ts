import { Profile } from "internal/profile";
import go from "tasks/go/go";
import usefulDirs from "tasks/useful-dirs/useful-dirs";

const profile = new Profile({
  name: "Test Profile",
});

profile.addTask(go, usefulDirs);

export default profile;
