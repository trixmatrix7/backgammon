// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title The protocol's participant ledger, as far as the game can see it.
///
/// @notice V2 stopped putting the roster in `LobbyContext`: a game reads it back from
///         whoever called it, because in production that caller is the facet. So a test
///         cannot simply call `Backgammon` from an EOA — the first `_seatOf` would call
///         into an address with no code and revert. This stands in for the facet: the
///         differential harness deploys it, and makes every call to the game FROM it.
///
///         Two fixed seats, in entry order, matching the addresses the harness uses.
contract MockLedger {
  address internal constant A = 0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa;
  address internal constant B = 0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB;

  function participantIndex(uint256, address p) external pure returns (bool joined, uint256 index) {
    if (p == A) return (true, 0);
    if (p == B) return (true, 1);
    return (false, 0);
  }

  function participantAt(uint256, uint256 index) external pure returns (address) {
    return index == 0 ? A : B;
  }

  /// @dev Forwards a call to the game so the game sees THIS contract as `msg.sender`.
  ///      `staticcall`, because every hook the game exposes is `view` or `pure` — if one
  ///      ever tries to write, this fails loudly rather than silently succeeding.
  function callGame(address game, bytes calldata data) external view returns (bytes memory) {
    (bool ok, bytes memory out) = game.staticcall(data);
    if (!ok) {
      assembly {
        revert(add(out, 0x20), mload(out))
      }
    }
    return out;
  }
}
