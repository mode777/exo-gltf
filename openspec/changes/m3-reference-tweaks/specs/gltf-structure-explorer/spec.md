# Spec Delta

## MODIFIED Requirements

### Requirement: Exploring never edits the document

The structure explorer SHALL be read-only: browsing, expanding and
selecting entries SHALL NOT modify the document or report the editor
dirty. Only explicit reference-repair actions may edit the document.

#### Scenario: Save while exploring

- **WHEN** the shell requests a save with the explorer open
- **THEN** the written file is byte-for-byte unchanged and the tab shows no dirty indicator
