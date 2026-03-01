
Hives
Hives are the core of the bot's gameplay, representing a player's xenomorph empire. Hives must be **created by users** after meeting specific requirements and grow as players evolve xenomorphs, unlock hive-specific features, and participate in events. Advanced hives unlock further customization options and specialization through modular upgrades and milestones.

Hives progress by managing **xenomorph roles**, evolving xenomorphs into powerful pathways like Queens, and interacting with features like hunting, faction battles, and hive-wide events.

Creating a Hive
Players begin their game by growing individual xenomorphs through eggs and hosts. Once specific conditions are met, players can create their first hive.  
- Hives come in different **types** (Default, Pathogen, Red, Custom), with specific unlock requirements for each type.  
- Once a Queen is evolved, the hive begins royal jelly production, enabling upgrades, evolutions, and system expansions.

Unlock Requirements for Hive Types
Default Hive (Black Xeno Hive)
- **Requirement**: You must own at least one xenomorph (any xeno stage: Facehugger, Chestburster, etc.).  
- **Description**: A balanced, standard hive suitable for beginners.  
- **Bonuses**:
  - 10% reduced evolution and upgrade costs.  
  - Steady jelly production (1 jelly/hour base).  

---

#### **Pathogen Hive**  
- **Requirement**: You must evolve a standard **Xeno Queen** into a **Pathogen Runner** (requires Pathogen Liquid).  
- **Effect**: Evolving into a Pathogen Runner deletes your Queen and current hive, forcing you to start fresh with this specialized hive type.  
- **Description**: A mutation-focused hive specializing in hybrid xenomorphs, risky hunts, and rare hosts.  
- **Bonuses**:
  - 20% mutation success rate.
  - Hybrid xenomorphs can gain unique abilities.  

---

#### **Red Hive**  
- **Requirement**: Kill or gather at least **1,000 hosts** during hunts or battles.  
- **Description**: A battle-oriented hive with bonuses for PvP combat and faction wars.  
- **Bonuses**:
  - +15% attack and defense stats in battles.  
  - Reduced battle cooldowns.  

---

#### **Custom Hive (Premium Feature)**  
- **Requirement**: Unlock via **Premium Purchase** or purchase **5 Egg Drops**.  
- **Description**: A fully customizable hive offering unique aesthetics, flexible xenomorph pathways, and hybrid-focused builds.  
- **Bonuses**:
  - Customizable jelly output and stat bonuses.  
  - Exclusive skins, animations, and perks.  

---

### Hive Creation Commands  
- `/hive create` – Start creating a hive if you meet the requirements for at least one type. Options are presented interactively.  
- `/hive delete` – Permanently delete your hive to transition to a new hive type.  
- `/hive type info` – Check details and unlock requirements for each hive type.  

---

## **Core Hive Systems**

### **1. Royal Jelly Production (Queen-Dependent)**  
Evolving a **Queen** is the key milestone for unlocking royal jelly production. Royal jelly is a critical resource for hatching xenos, upgrading the hive, enabling evolutions, and initiating hybridization mutations.  

- Players must evolve a Drone → Warrior → Praetorian → Queen pathway to unlock jelly production.  
- **Base Jelly Output**: 1 jelly/hour after evolving a Queen.  
- Losing the Queen (e.g., during Pathogen mutation) completely halts jelly production until a new Queen is evolved.  
- Hive upgrades and milestones improve jelly production efficiency.  

**Commands**:  
- `/hive queen-status` – View your Queen's production rate, stats, and available upgrades.  
- `/hive upgrade-queen` – Improve the Queen Chamber to increase jelly output or unlock special bonuses.  

---

### **2. Hive Capacity Growth**  
Hives start with limited capacity, expanded as milestones are reached and upgrades are purchased.

#### Capacity Levels:  
- **Level 1**: 5 xenos (default capacity).  
- **Level 2**: 15 xenos (unlocks milestones tracking).  
- **Level 3**: 30 xenos (unlocks Hatchery module).  
- **Level 4**: 50 xenos (unlocks defensive bonuses).  
- **Level 5+**: Expansions available for advanced hives.  

---

### **3. Hive Modular Upgrades**  
Modular upgrades allow players to specialize their hive functionality. Modules can be upgraded independently, adding depth to hive management.

#### Example Modules:  
1. **Royal Jelly Refinery**:  
   - Boost jelly production rates or reduce jelly costs for evolutions and upgrades.  

2. **Hatchery**:  
   - Decrease egg hatch times; advanced levels allow multiple simultaneous hatches.  

3. **Incubation System**:  
   - Improve mutation success rates during hybrid evolutions.  

4. **Defensive Walls**:  
   - Reduce xenomorph losses during faction battles or hive invasions.  

**Commands**:  
- `/hive modules` – View all modules and their levels.  
- `/hive upgrade-module [module_name]` – Spend jelly to enhance specific modules.  

---

### **4. Dynamic Hive Events**  
Hives will occasionally experience events, encouraging dynamic interaction and rewarding resource management.  

#### Example Events:  
- **Hive Invasion**: Enemy NPCs attack, and losing the Queen results in temporary jelly production penalties.  
- **Hunt Swarm**: Better odds of rare hosts and double hunting rewards for 30 minutes.  
- **Feral Mutation**: Random xenomorph gains new abilities but has random stat trade-offs.  

**Commands**:  
- `/hive events` – Check active events.  
- `/hive defend` – Assign defensive xenos to repel invasions or minimize losses.  

---

### **5. Milestone Rewards**  
Player progression is incentivized with milestone-based rewards linked to hive capacity, jelly production, hunts, and faction battles.  

#### Example Milestones:  
- **Hunt Milestones**:  
  - Complete 100 hunts: Gain +10% rare host capture chance.  

- **Capacity Milestones**:  
  - Reach 30 xenos: Unlock Hybrid Evolution Research bonus.  

- **Jelly Production Milestones**:  
  - Produce 1000 jelly: Receive exclusive rare hybrid egg (e.g., Predalien).  

**Commands**:  
- `/hive milestones` – Track progress toward specific goals.  

---

### **Hive Stats and Customization Commands**  
- `/hive rename [name]` – Rename your hive, restricted to once every 48 hours.  
- `/hive stats` – View stats like xenomorph count, jelly production, faction battles, hunts, and milestones.  