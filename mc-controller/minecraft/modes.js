import * as skills from './skills.js';
import * as world from './world.js';
import * as mc from './mcdata.js';

function say(bot, message) {
    if (bot.modes) {
        bot.modes.behavior_log.push({
            time: Date.now(),
            mode: 'say',
            detail: message
        });
    }
}

// a mode is a function that is called every tick to respond immediately to the world
// it has the following fields:
// on: whether 'update' is called every tick
// active: whether an action has been triggered by the mode and hasn't yet finished
// paused: whether the mode is paused by another action that overrides the behavior (eg followplayer implements its own self defense)
// update: the function that is called every tick (if on is true)
// when a mode is active, it will trigger an action to be performed but won't wait for it to return output

// the order of this list matters! first modes will be prioritized
// while update functions are async, they should *not* be awaited longer than ~100ms as it will block the update loop
// to perform longer actions, use the execute function which won't block the update loop
const modes_list = [
    {
        name: 'self_preservation',
        description: 'Respond to drowning, burning, and damage at low health. Interrupts all actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        fall_blocks: ['sand', 'gravel', 'concrete_powder'], // includes matching substrings like 'sandstone' and 'red_sand'
        update: async function (ctx) {
            const bot = ctx.bot;
            let block = bot.blockAt(bot.entity.position);
            let blockAbove = bot.blockAt(bot.entity.position.offset(0, 1, 0));
            if (!block) block = {name: 'air'}; // hacky fix when blocks are not loaded
            if (!blockAbove) blockAbove = {name: 'air'};
            if (blockAbove.name === 'water') {
                // does not call execute so does not interrupt other actions
                if (!bot.pathfinder.goal) {
                    bot.setControlState('jump', true);
                }
            }
            else if (this.fall_blocks.some(name => blockAbove.name.includes(name))) {
                execute(this, ctx.bot, async () => {
                    await skills.moveAway(bot, 2);
                });
            }
            else if (block.name === 'lava' || block.name === 'fire' ||
                blockAbove.name === 'lava' || blockAbove.name === 'fire') {
                say(bot, 'I\'m on fire!');
                // if you have a water bucket, use it
                let waterBucket = bot.inventory.items().find(item => item.name === 'water_bucket');
                if (waterBucket) {
                    execute(this, ctx.bot, async () => {
                        let success = await skills.placeBlock(bot, 'water_bucket', block.position.x, block.position.y, block.position.z);
                        if (success) say(bot, 'Placed some water, ahhhh that\'s better!');
                    });
                }
                else {
                    execute(this, ctx.bot, async () => {
                        let waterBucket = bot.inventory.items().find(item => item.name === 'water_bucket');
                        if (waterBucket) {
                            let success = await skills.placeBlock(bot, 'water_bucket', block.position.x, block.position.y, block.position.z);
                            if (success) say(bot, 'Placed some water, ahhhh that\'s better!');
                            return;
                        }
                        let nearestWater = world.getNearestBlock(bot, 'water', 20);
                        if (nearestWater) {
                            const pos = nearestWater.position;
                            let success = await skills.goToPosition(bot, pos.x, pos.y, pos.z, 0.2);
                            if (success) say(bot, 'Found some water, ahhhh that\'s better!');
                            return;
                        }
                        await skills.moveAway(bot, 5);
                    });
                }
            }
            else if (Date.now() - bot.lastDamageTime < 3000 && (bot.health < 5 || bot.lastDamageTaken >= bot.health)) {
                say(bot, 'I\'m dying!');
                execute(this, ctx.bot, async () => {
                    await skills.moveAway(bot, 20);
                });
            }
            else if (!ctx.actionQueue?.executing) {
                bot.clearControlStates(); // clear jump if not in danger or doing anything else
            }
        }
    },
    {
        name: 'unstuck',
        description: 'Attempt to get unstuck when in the same place for a while. Interrupts some actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        prev_location: null,
        distance: 2,
        stuck_time: 0,
        last_time: Date.now(),
        max_stuck_time: 20,
        prev_dig_block: null,
        update: async function (ctx) {
            if (!ctx.actionQueue?.executing) {
                this.prev_location = null;
                this.stuck_time = 0;
                return; // don't get stuck when idle
            }
            const bot = ctx.bot;
            const cur_dig_block = bot.targetDigBlock;
            if (cur_dig_block && !this.prev_dig_block) {
                this.prev_dig_block = cur_dig_block;
            }
            if (this.prev_location && this.prev_location.distanceTo(bot.entity.position) < this.distance && cur_dig_block == this.prev_dig_block) {
                this.stuck_time += (Date.now() - this.last_time) / 1000;
            }
            else {
                this.prev_location = bot.entity.position.clone();
                this.stuck_time = 0;
                this.prev_dig_block = null;
            }
            const max_stuck_time = cur_dig_block?.name === 'obsidian' ? this.max_stuck_time * 2 : this.max_stuck_time;
            if (this.stuck_time > max_stuck_time) {
                say(bot, 'I\'m stuck!');
                this.stuck_time = 0;
                execute(this, ctx.bot, async () => {
                    await skills.moveAway(bot, 5);
                    say(bot, 'I\'m free.');
                });
            }
            this.last_time = Date.now();
        },
        unpause: function () {
            this.prev_location = null;
            this.stuck_time = 0;
            this.prev_dig_block = null;
        }
    },
    {
        name: 'cowardice',
        description: 'Run away from enemies. Interrupts all actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        update: async function (ctx) {
            const bot = ctx.bot;
            const enemy = world.getNearestEntityWhere(bot, entity => mc.isHostile(entity), 16);
            if (enemy && await world.isClearPath(bot, enemy)) {
                say(bot, `Aaa! A ${enemy.name.replace("_", " ")}!`);
                execute(this, ctx.bot, async () => {
                    await skills.avoidEnemies(bot, 24);
                });
            }
        }
    },
    {
        name: 'self_defense',
        description: 'Attack nearby enemies. Interrupts all actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        update: async function (ctx) {
            const bot = ctx.bot;
            const enemy = world.getNearestEntityWhere(bot, entity => mc.isHostile(entity), 8);
            if (enemy && await world.isClearPath(bot, enemy)) {
                say(bot, `Fighting ${enemy.name}!`);
                execute(this, ctx.bot, async () => {
                    await skills.defendSelf(bot, 8);
                });
            }
        }
    },
    {
        name: 'hunting',
        description: 'Hunt nearby animals when idle.',
        interrupts: ['action:followPlayer'],
        on: true,
        active: false,
        update: async function (ctx) {
            const bot = ctx.bot;
            const huntable = world.getNearestEntityWhere(bot, entity => mc.isHuntable(entity), 8);
            if (huntable && await world.isClearPath(bot, huntable)) {
                execute(this, ctx.bot, async () => {
                    say(bot, `Hunting ${huntable.name}!`);
                    await skills.attackEntity(bot, huntable);
                });
            }
        }
    },
    {
        name: 'item_collecting',
        description: 'Collect nearby items when idle.',
        interrupts: ['action:followPlayer'],
        on: true,
        active: false,

        wait: 2, // number of seconds to wait after noticing an item to pick it up
        prev_item: null,
        noticed_at: -1,
        update: async function (ctx) {
            const bot = ctx.bot;
            let item = world.getNearestEntityWhere(bot, entity => entity.name === 'item', 8);
            let empty_inv_slots = bot.inventory.emptySlotCount();
            if (item && item !== this.prev_item && await world.isClearPath(bot, item) && empty_inv_slots > 1) {
                if (this.noticed_at === -1) {
                    this.noticed_at = Date.now();
                }
                if (Date.now() - this.noticed_at > this.wait * 1000) {
                    say(bot, `Picking up item!`);
                    this.prev_item = item;
                    execute(this, ctx.bot, async () => {
                        await skills.pickupNearbyItems(bot);
                    });
                    this.noticed_at = -1;
                }
            }
            else {
                this.noticed_at = -1;
            }
        }
    },
    {
        name: 'torch_placing',
        description: 'Place torches when idle and there are no torches nearby.',
        interrupts: ['action:followPlayer'],
        on: true,
        active: false,
        cooldown: 5,
        last_place: Date.now(),
        update: function (ctx) {
            const bot = ctx.bot;
            if (world.shouldPlaceTorch(bot)) {
                if (Date.now() - this.last_place < this.cooldown * 1000) return;
                execute(this, ctx.bot, async () => {
                    const pos = bot.entity.position;
                    await skills.placeBlock(bot, 'torch', pos.x, pos.y, pos.z, 'bottom', true);
                });
                this.last_place = Date.now();
            }
        }
    },
    {
        name: 'elbow_room',
        description: 'Move away from nearby players when idle.',
        interrupts: ['action:followPlayer'],
        on: true,
        active: false,
        distance: 0.5,
        update: async function (ctx) {
            const bot = ctx.bot;
            const player = world.getNearestEntityWhere(bot, entity => entity.type === 'player', this.distance);
            if (player) {
                execute(this, ctx.bot, async () => {
                    // wait a random amount of time to avoid identical movements with other bots
                    const wait_time = Math.random() * 1000;
                    await new Promise(resolve => setTimeout(resolve, wait_time));
                    if (player.position.distanceTo(bot.entity.position) < this.distance) {
                        await skills.moveAwayFromEntity(bot, player, this.distance);
                    }
                });
            }
        }
    },
    {
        name: 'idle_staring',
        description: 'Animation to look around at entities when idle.',
        interrupts: [],
        on: true,
        active: false,

        staring: false,
        last_entity: null,
        next_change: 0,
        update: function (ctx) {
            const bot = ctx.bot;
            const entity = bot.nearestEntity();
            let entity_in_view = entity && entity.position.distanceTo(bot.entity.position) < 10 && entity.name !== 'enderman';
            if (entity_in_view && entity !== this.last_entity) {
                this.staring = true;
                this.last_entity = entity;
                this.next_change = Date.now() + Math.random() * 1000 + 4000;
            }
            if (entity_in_view && this.staring) {
                let isbaby = entity.type !== 'player' && entity.metadata[16];
                let height = isbaby ? entity.height/2 : entity.height;
                bot.lookAt(entity.position.offset(0, height, 0));
            }
            if (!entity_in_view)
                this.last_entity = null;
            if (Date.now() > this.next_change) {
                // look in random direction
                this.staring = Math.random() < 0.3;
                if (!this.staring) {
                    const yaw = Math.random() * Math.PI * 2;
                    const pitch = (Math.random() * Math.PI/2) - Math.PI/4;
                    bot.look(yaw, pitch, false);
                }
                this.next_change = Date.now() + Math.random() * 10000 + 2000;
            }
        }
    },
    {
        name: 'cheat',
        description: 'Use cheats to instantly place blocks and teleport.',
        interrupts: [],
        on: false,
        active: false,
        update: function (ctx) { /* do nothing */ }
    }
];

async function execute(mode, bot, func, timeout=-1) {
    const actionQueue = bot._actionQueueRef;

    // Interrupt ongoing action queue work if needed
    if (actionQueue && actionQueue.executing) {
        actionQueue.interruptForMode();
    }

    mode.active = true;

    try {
        if (timeout > 0) {
            await Promise.race([
                func(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`Mode ${mode.name} timed out`)), timeout)
                )
            ]);
        } else {
            await func();
        }
    } catch (err) {
        console.log(`Mode ${mode.name} error: ${err.message}`);
    }

    mode.active = false;
    console.log(`Mode ${mode.name} finished executing.`);

    // Resume action queue after mode finishes
    if (actionQueue) {
        actionQueue.resumeAfterMode();
    }
}

const modes_map = {};
for (let mode of modes_list) {
    modes_map[mode.name] = mode;
}

class ModeController {
    /*
    SECURITY WARNING:
    ModeController must be reference isolated. Do not store references to external objects like `agent`.
    This object is accessible by LLM generated code, so any stored references are also accessible.
    This can be used to expose sensitive information by malicious prompters.
    */
    constructor(bot) {
        this.bot = bot;
        this.behavior_log = [];
    }

    exists(mode_name) {
        return modes_map[mode_name] != null;
    }

    setOn(mode_name, on) {
        modes_map[mode_name].on = on;
    }

    isOn(mode_name) {
        return modes_map[mode_name].on;
    }

    pause(mode_name) {
        modes_map[mode_name].paused = true;
    }

    unpause(mode_name) {
        const mode = modes_map[mode_name];
        //if unpause func is defined and mode is currently paused
        if (mode.unpause && mode.paused) {
            mode.unpause();
        }
        mode.paused = false;
    }

    unPauseAll() {
        for (let mode of modes_list) {
            if (mode.paused) console.log(`Unpausing mode ${mode.name}`);
            this.unpause(mode.name);
        }
    }

    getMiniDocs() { // no descriptions
        let res = 'Agent Modes:';
        for (let mode of modes_list) {
            let on = mode.on ? 'ON' : 'OFF';
            res += `\n- ${mode.name}(${on})`;
        }
        return res;
    }

    getDocs() {
        let res = 'Agent Modes:';
        for (let mode of modes_list) {
            let on = mode.on ? 'ON' : 'OFF';
            res += `\n- ${mode.name}(${on}): ${mode.description}`;
        }
        return res;
    }

    async update() {
        const actionQueue = this.bot._actionQueueRef;
        const isIdle = !actionQueue?.executing;
        const ctx = { bot: this.bot, actionQueue };

        if (isIdle) {
            this.unPauseAll();
        }
        for (let mode of modes_list) {
            let currentActionLabel = actionQueue?.current?.action
                ? `action:${actionQueue.current.action}`
                : null;
            let interruptible = mode.interrupts.some(i => i === 'all') ||
                (currentActionLabel && mode.interrupts.some(i => i === currentActionLabel));
            if (mode.on && !mode.paused && !mode.active && (isIdle || interruptible)) {
                await mode.update(ctx);
            }
            if (mode.active) break;
        }
    }

    flushBehaviorLog() {
        const log = this.behavior_log;
        this.behavior_log = [];
        return log;
    }

    getJson() {
        let res = {};
        for (let mode of modes_list) {
            res[mode.name] = mode.on;
        }
        return res;
    }

    loadJson(json) {
        for (let mode of modes_list) {
            if (json[mode.name] != undefined) {
                mode.on = json[mode.name];
            }
        }
    }
}

const UPDATE_INTERVAL_MS = 500;

export function initModes(bot, actionQueue) {
    // Store actionQueue reference on bot for access by execute()
    bot._actionQueueRef = actionQueue;

    // Create the mode controller and attach it to the bot
    bot.modes = new ModeController(bot);

    // Start the tick interval for mode updates
    const intervalId = setInterval(async () => {
        if (!bot.entity) return; // not spawned yet
        try {
            await bot.modes.update();
        } catch (err) {
            console.error('Mode update error:', err.message);
        }
    }, UPDATE_INTERVAL_MS);

    // Clean up interval when bot disconnects
    bot.once('end', () => {
        clearInterval(intervalId);
    });

    return bot.modes;
}
