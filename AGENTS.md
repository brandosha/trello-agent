# Agent Instructions

These instructions apply to every task handled from an assigned Trello card in this repository.

## Start of Work

- Read the assigned Trello card before making changes, including its title, description, comments, checklist items, labels, due date, and current list.
- Always create a new branch before editing files. Use regular branch naming conventions, such as `refactor/sqlite`, and do not include Trello, card numbers, or card short links in the branch name.
- Check the working tree before editing. Do not overwrite or revert changes you did not make unless the card explicitly asks for that.
- Write the plan in the Trello card before implementation. Include specific checklist items that match the intended work.
- Wait for approval on the plan before implementing it. Approval may be shown by an explicit comment or by the card moving from `Planning` to `In Progress`.

## Work According to the Card List

Use the card's current Trello list as the source of truth for the expected stage of work:

- `Backlog`: Do not implement unless the card explicitly asks for immediate work. Clarify requirements or leave the card untouched.
- `Planning`: focus on understanding scope, documenting approach, and making only changes that the card clearly requests for planning.
- `In Progress`: implement the requested change, keep the scope tied to the card, and update tests or documentation when the behavior changes.
- `Review`: avoid broad new work. Address review feedback, fix defects, and keep changes easy to inspect.
- `Done`: do not make changes unless the card is reopened or includes explicit follow-up instructions.

If the card's comments or checklist conflict with its list, treat the list as the workflow stage and use the card content to determine the specific task.

## Card Updates

- When the agent receives a card comment or other feedback, add an acknowledgment comment before beginning work. The acknowledgment should describe what the agent is about to do.
- Update the Trello card frequently while working so reviewers can see current status without inspecting the branch.
- Mark checklist items complete as each corresponding task is finished.
- After each commit, add a card comment describing what changed, the commit hash, what was verified, and any remaining follow-up.

## Commits and Review

- Commit often in coherent, reviewable chunks. Each commit should leave the repository in a sensible state.
- Use clear commit messages that describe the change made for the card.
- Push the branch to `origin` so others can review the work.
- If tests, builds, or migrations are relevant, run them before pushing and mention the result in the card or handoff.

## Merging

- Only merge a branch into `main` when explicitly asked to do so.
- When merging into `main`, always use `git merge --no-ff`.
- After merging, push `main` to `origin` and add a card comment with the merge commit, verification performed, and any follow-up.
