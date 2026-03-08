import { Profile } from "internal/profile";
import fish from "tasks/fish/fish";

const profile = new Profile({
  name: "Test Profile",
});

profile.addTask(fish);

export default profile;
