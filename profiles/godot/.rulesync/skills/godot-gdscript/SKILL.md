---
name: godot-gdscript
description: "GDScript and Godot 4 conventions: script order, static typing, naming, signals, composition, scene structure. Use when writing or reviewing .gd files or designing scenes."
metadata:
  author: Federico Ara
---

# godot-gdscript

Godot 4.x, typed GDScript. Follow the official style guide; the project's own `AGENTS.md` wins where it differs.

## Format

- Tabs for indentation (the editor and `gdformat` expect them). One statement per line, about 100 columns.
- Do not reformat existing files; format only new files or lines you touch.

## Script order

1. `@tool`, `@icon`
2. `class_name`, then `extends`
3. `##` doc comment
4. `signal`, `enum`, `const`
5. `@export` vars, public vars, private vars (`_name`), `@onready` vars
6. `_init()`, `_ready()`, other virtuals (`_process`, `_physics_process`, `_input`)
7. Public methods, then private methods (`_name`)

## Naming

| Item | Convention | Example |
|---|---|---|
| Files (`.gd`, `.tscn`) | snake_case | `player_controller.gd` |
| `class_name`, nodes | PascalCase | `PlayerController`, `HitBox` |
| Functions, variables | snake_case | `take_damage()` |
| Private members | leading `_` | `_health` |
| Constants, enum values | CONSTANT_CASE | `MAX_SPEED` |
| Signals | snake_case, past tense | `health_changed` |

## Typing

Type everything: `var speed: float = 300.0`, `func hit(amount: int) -> void:`. Use `:=` only when the type is obvious from the right side. Typed arrays and dictionaries where the version supports them (`Array[Enemy]`).

## Structure

- Signals up, calls down: a child emits, its owner connects. A child never reaches for its parent (`get_parent()` chains, `../..` paths).
- Composition over inheritance: behavior lives in child nodes or scenes (`HealthComponent`, `StateMachine`), not in deep class trees.
- `%UniqueName` for nodes a script needs; avoid long `$A/B/C` paths.
- Movement and physics in `_physics_process`; visuals in `_process`.
- `preload()` constants for scenes used often; `load()` for optional or late resources.
- `res://` is the project; `user://` is for saves and caches.

## Gotchas for Python habits

- Integer division: `7 / 2 == 3`; write `7.0 / 2` for a float.
- No f-strings: `"%s hp" % hp` or `str()`.
- `_ready()` runs when the node enters the tree, after its children; not at construction.
- `StringName` literals (`&"jump"`) for input actions, groups and signal names in hot paths.

## Checks

Run the closing gate from the godot rule after editing scripts. Read errors by file and line; fix the first one, then rerun.
