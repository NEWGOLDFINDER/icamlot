---
titre: French Robotics Cup 2026
date: 2026-05-30
resume: The team reaches the knockout stage for the first time!
---
French Robotics Cup wrap-up: strategy, SIMAs and twists for Team Opossum!

The French Robotics Cup has come to an end, and it's time for the team to do the traditional wrap-up of this edition.

First of all, a huge thank you to the organisers and all the volunteers. Once again this year, it was a real pleasure to take part in this event and to chat with all the teams there!

# A new approach: strategy first
After dropping the "actuator mechanics" last year in order to build the most solid mechanical and software base possible, our goal this year was clear: play strategically.

No more pre-programmed scripts! Our robot analysed the situation live and chose its actions fully autonomously. We only gave it weights to define priority actions, and it managed on its own. The result? A robot that was extremely enjoyable to watch on the table, able to go and play on the opponent's side and steal objects opportunistically.

However, we quickly realised that while this method makes for a great show, it is absolutely not optimal for securing safe points in the group stage. That's a major area of improvement for us.

# The SIMAs join the team
For this edition, we also developed our first SIMAs (Small Independent Mobile Actuators). Heavily inspired by those of the TDS team, our little "minions" weren't very fast at first, with fairly imprecise localization early in the Cup.

Fortunately, match after match, things improved a lot. We finished the competition with 4 reliable SIMAs that always reach their destination!

# The edition's sore point: avoidance and its dilemmas
Even when they reached their destination, one major problem played spoilsport: avoidance.

Our SIMAs have dynamic avoidance located just above the nut crates. The catch? If crates were placed at an angle in the drop zones, they ended up at lidar height. The SIMA would then try to avoid them and never reach its destination.

Our big robot, on the other hand, adapted its strategy perfectly when it met an opposing robot, but it did not avoid the SIMAs. During homologation, we agreed on a compromise with the referees: after the 85th second, we dropped the robot's speed from 1.5 m/s to 0.3 m/s so as not to risk damaging the SIMAs we couldn't detect.

# Match recap: highs and cold sweats
Match 1: Our robot goes to play in the opponent's zone. Faced with obvious proximity, the opposing robot runs into us. The referees ask us to widen our avoidance radius. Despite this, we're delighted with our machine's performance: it moves a lot, circles the opponent and even picks up better than in training!

Match 2: We comply and widen the avoidance. First problem: it conflicts with our strategy and the robot often gets stuck. Worse, while our robot is on the other side, the Karibelles' SIMA is near a piece we're trying to pick up. Result: emergency stop and warning. We have a torque measurement on our gripper so it releases if it forces, so no damage was done, but the sword of Damocles is there. If we touch a SIMA again, it's a penalty. From now on we must definitively stop our matches at 85s.

Match 3 (vs Azbot): A really nice match! Our robot manages to steal two stacks dropped by the opponent. Aware that this isn't necessarily "the spirit of the group stage", we apologise, but Azbot's reaction was great. Thanks to them!

Match 4: An almost nominal match. The robot makes good choices, the SIMAs do the job, but the overly wide avoidance keeps jamming the robot from time to time.

Match 5 (vs TDS): The best match of our Cup! Lots of movement, steals on both sides, and holonomic SIMAs coming to life at the end of the match on both sides. That's exactly what we wanted to see! We were just one untouched stack short at the end.

# Knockout stage: an emotional rollercoaster
In the round of 16, no more stopping at 85s — you have to play the full 100 seconds!
Our plan: force our SIMAs to play behind us, and keep the grippers down in "snowplough" mode to push objects without crushing a possible SIMA. In theory, we position ourselves near their zone, push the opponent's objects, and drop ours there.

The drama: the opposing robot stays parked in front of us while we're in front of their zone. With our widened avoidance, our robot ends up completely stuck. The referees' conclusion: unfair play for staying in front of the SIMA zone (obstruction). Verdict: 50-point penalty.

For the next match against Team Diff, we have to abandon this strategy and go back to group-stage settings. Unfortunately, the time lost arguing with the officials prevents us from making our adjustments (the famous git checkout on an old branch backstage...). We're eliminated.

# Conclusion: delighted, humbled and inspired!
Despite this abrupt ending, we are extremely happy with this Cup!

What we take away:

It would be far wiser to develop a "very safe" mode for the group stage, to secure points without breaking our strategy with shaky avoidance.

We'd like more clarity on avoidance rules going forward (Who avoids whom? The same rules for everyone?). The fear of touching a SIMA biased our choices throughout the event.

We loved our encounters against TDS, Hyperion (who humbled us by clearing the table in the time it took us to pick up a stack in training!) and 7Robot, with whom we got to test various strategies.

We very much hope to see rules again that allow stealing and push robots to interact. It was fascinating to design. We leave this Cup with our heads full of ideas for next year!

Thanks again to the organisers, the volunteers, and all the teams who came by our stand for a chat. The Cup remains an unforgettable moment!

Team Opossum

![](photo1.jpg)
