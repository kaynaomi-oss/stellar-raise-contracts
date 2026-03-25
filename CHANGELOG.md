# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Pending changes not yet released will appear here

## [0.1.0] - 2026-02-19

### Added

- Initial crowdfund smart contract built on Soroban
- `initialize` function to create a campaign with creator, token, goal, and deadline
- `contribute` function to allow contributors to fund the campaign
- `withdraw` function for the creator to claim funds when goal is met
- `refund` function to return funds to contributors when goal is not met
- `total_raised`, `goal`, and `deadline` view helpers
- Basic test suite covering `initialize`, `contribute`, `withdraw`, and `refund` flows
