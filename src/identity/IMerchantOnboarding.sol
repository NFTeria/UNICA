// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title IMerchantOnboarding — a regular business joins UNICA in one transaction from its own wallet
/// @notice The self-serve door. A business owner connects an ordinary wallet, picks a name, and calls
///         `join`. In that one transaction the business receives: a name under the UNICA parent
///         (`<label>.unica.eth` locally), a payout address record, a `terminals` branch, a first
///         register (terminal) that is ACTIVE with the owner's wallet as its operator, and the
///         non-transferable identity badge. When `join` returns, the business owner's wallet OWNS the
///         merchant name and every node under it; this contract keeps no role on any of them.
///
///         WHY ONE TRANSACTION. A half-configured business (name but no payout, or a register with no
///         operator) is a business that cannot be paid or can be paid to nobody. Either the whole
///         setup exists or none of it does.
///
///         WHY NO ADMIN CAN JOIN ON SOMEONE'S BEHALF. Ownership follows `msg.sender`; there is no
///         `joinFor(address)`. A name a business did not ask for is a name it cannot trust.
///
///         LABELS. Lowercase `a-z`, digits and single hyphens, 3 to 32 characters, no leading or
///         trailing hyphen, no double hyphen. The same character class `vy/src/math/namecheck.vy`
///         accepts, so a joined name always renders on the badge.
interface IMerchantOnboarding {
    /// @notice A business joined. `merchantNode` is now owned by `owner`; `firstTerminalNode` is
    ///         ACTIVE with `owner` as its operator; `badgeTokenId` is the identity token minted to `owner`.
    event BusinessJoined(
        bytes32 indexed merchantNode,
        address indexed owner,
        string label,
        address payout,
        bytes32 terminalsNode,
        bytes32 firstTerminalNode,
        uint256 badgeTokenId
    );

    error LabelInvalid(string label);
    error LabelTaken(string label);
    error AlreadyJoined(address owner, bytes32 merchantNode);
    error BadgeNotLinked();
    error BadgeAlreadyLinked(address badge);
    error NotAdmin(address who);

    /// @notice Join with `label` as the business name and `payout` as the address that receives
    ///         settlements. `payout == address(0)` means the caller's own wallet. `firstTerminalLabel`
    ///         names the first register (for example "register-1" or "chair-1").
    /// @return merchantNode the business's node, owned by the caller when this returns
    /// @return terminalsNode the `terminals.<label>` node, owned by the caller
    /// @return firstTerminalNode the first register, ACTIVE, operator = caller, owned by the caller
    /// @return badgeTokenId the identity badge minted to the caller
    function join(string calldata label, address payout, string calldata firstTerminalLabel)
        external
        returns (bytes32 merchantNode, bytes32 terminalsNode, bytes32 firstTerminalNode, uint256 badgeTokenId);

    /// @notice Pure label rule, exposed so a screen can refuse a bad name before any transaction.
    function isValidLabel(string calldata label) external pure returns (bool);

    /// @notice The merchant node a wallet joined with, or zero. One business per wallet in this release.
    function merchantOf(address owner) external view returns (bytes32);

    /// @notice The node a label maps to under the parent, or zero if nobody joined with it.
    function nodeOf(string calldata label) external view returns (bytes32);

    /// @notice The identity authority this contract configures names in (the local ENSv2-compatible
    ///         fixture in this release).
    function IDENTITY() external view returns (address);

    /// @notice The parent every business joins under (`unica.eth` locally).
    function PARENT_NODE() external view returns (bytes32);

    /// @notice The text key that carries a register's status ("active" / "revoked").
    function TERMINAL_STATUS_KEY() external view returns (string memory);

    /// @notice The identity badge contract, once linked; zero before.
    function badge() external view returns (address);

    /// @notice One-time link of the badge (deployed after this contract with this contract as its
    ///         minter). Admin only; refused a second time. Until linked, `join` refuses with
    ///         `BadgeNotLinked`, because a business without its badge is not fully set up.
    function linkBadge(address badgeToken) external;
}
