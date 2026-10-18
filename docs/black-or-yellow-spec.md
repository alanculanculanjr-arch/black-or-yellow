# **BLACK OR YELLOW**

## **Complete IoT Carnival Game Project Handoff and Requirements Specification**

**Project status:** Requirements gathering completed through Question 125. Ready for specification validation, software architecture design, hardware integration planning, and implementation.

**IMPORTANT INSTRUCTION TO THE NEXT AI:**

You are taking over an ongoing engineering project. The previous AI and I completed 125 numbered requirements discussions.

Treat the decisions documented below as our established project requirements. Do not restart the requirements questionnaire or repeatedly ask questions already answered.

Where earlier decisions conflict with later ones, the latest confirmed decision takes priority.

Distinguish between confirmed requirements, examples, engineering recommendations, and genuinely unresolved details.

Ask clarifying questions only when a missing decision materially affects implementation. Prioritize helping me build a functional, lightweight, demonstrable prototype.

-----

# **1. PROJECT OVERVIEW**

## **1.1 Project name**

**Black or Yellow**

The project was previously designed around Black and Red, but Red was replaced by Yellow.

The final two betting colors are:

  - BLACK
  - YELLOW

Never revert to Black and Red.

## **1.2 Project purpose**

Build a working IoT carnival-style betting game that integrates:

  - A Raspberry Pi 5
  - A physical 4×4 playing board
  - A small rolling ball
  - An overhead Android smartphone camera
  - Computer vision for automatic ball-position detection
  - Servo-controlled ball release
  - Servo-controlled playing board tilt
  - A blower-based ball-return system
  - A browser-based player interface
  - A browser-based banker/admin dashboard
  - A virtual points wallet
  - Banker-controlled prop-money purchases and redemptions
  - Real-time networking between devices
  - Database-backed account, wallet, and transaction persistence

This is a **classroom or demonstration prototype**, not a real-money gambling product.

All coins and peso amounts are fictional prop currency. Points have no real monetary value.

## **1.3 Basic gameplay**

Players choose either BLACK or YELLOW and wager virtual points.

The banker closes betting and activates the physical ball drop.

One ball lands on the board.

Computer vision determines which cell the ball occupies.

Each cell is permanently assigned to BLACK or YELLOW.

The banker verifies and confirms the detected result.

Players who selected the winning color receive twice their wager, including the original stake.

The system then recovers the ball and prepares for the next round.

-----

# **2. HARDWARE PLATFORM**

## **2.1 Main controller**

**Raspberry Pi 5 — 8 GB RAM**

Important storage clarification:

The Raspberry Pi currently has approximately **2.9 GB of free storage**.

This does not mean the Raspberry Pi has only 2.9 GB total storage.

All software should remain lightweight enough to operate within the available free space.

Avoid unnecessary heavyweight frameworks, large machine-learning models, continuous video recording, and excessive cached files.

## **2.2 Hardware components**

The planned system includes:

1.  Raspberry Pi 5, 8 GB RAM.
2.  An Android smartphone serving as the overhead IP camera.
3.  A separate Android smartphone providing the dedicated Wi-Fi hotspot.
4.  A banker smartphone for controlling the game.
5.  Up to ten active player smartphones.
6.  A 4×4 physical playing board.
7.  One small light-colored deodorant roller ball.
8.  One servo-controlled trapdoor ball-release mechanism.
9.  Two board-tilting servo motors.
10. A ball funnel or collection channel.
11. A return tube.
12. An electrically controlled blower.
13. Appropriate motor drivers, external power supplies, and safety components.

The exact servo models, blower model, physical dimensions, and electrical pin assignments have not yet been finalized.

## **2.3 Physical construction responsibilities**

The group will handle the physical layout and construction.

The next AI should provide software, control logic, safety guidance, and interface design without repeatedly redesigning the physical board against our stated preferences.

-----

# **3. PLAYING BOARD**

## **3.1 Grid arrangement**

The playing surface contains exactly:

**4 rows × 4 columns = 16 square cells**

Each cell is assigned to one of two colors:

  - 8 BLACK cells
  - 8 YELLOW cells

The arrangement is a permanent checkerboard.

An example consistent with the checkerboard numbering, using row-major cell numbering from 1 to 16, is:

|  |  |  |  |
| :-: | :-: | :-: | :-: |
| \*\*BLACK\*\* | \*\*YELLOW\*\* | \*\*BLACK\*\* | \*\*YELLOW\*\* |
| YELLOW | BLACK | YELLOW | BLACK |
| BLACK | YELLOW | BLACK | YELLOW |
| YELLOW | BLACK | YELLOW | BLACK |

Numbering:

BLACK: 1, 3, 6, 8, 9, 11, 14, 16

YELLOW: 2, 4, 5, 7, 10, 12, 13, 15

The exact checkerboard orientation can be verified during calibration.

## **3.2 Surface design**

The playing board uses low grid sticks or dividers separating the cells.

It does **not** have concave holes or individual ball pockets.

The ball is released from an elevated position, bounces and rolls between cells, and eventually settles.

The sticks should allow a moving ball to cross cells but help contain it once its speed becomes sufficiently low.

## **3.3 Ball**

There is only **ONE physical ball**.

The ball is a small, white or light-colored deodorant roller ball.

The original multiple-ball concept has been abandoned.

Each round consists of exactly one ball drop and one winning color.

-----

# **4. BALL RELEASE MECHANISM**

The banker initiates the release through the web dashboard.

The relevant control is:

**DROP**

The Raspberry Pi commands a servo to open a trapdoor or equivalent release gate.

The ball drops from an elevated platform onto the checkerboard.

After releasing the ball, the gate returns to its ready position as appropriate for the physical mechanism.

The system then begins monitoring the ball using computer vision.

The banker cannot initiate another drop while the current attempt is still being processed.

A new drop requires the system to be in an appropriate ready state.

-----

# **5. AUTOMATED BALL RETURN**

## **5.1 Servo arrangement**

The playing board is controlled by **two servo motors**.

They are positioned at the midpoints of two opposing sides of the playing board.

Their movement tilts the board to guide the ball toward the collection area.

The specific linkage arrangement is the group's mechanical responsibility.

## **5.2 Recovery sequence**

Once a result is confirmed, the system automatically begins ball recovery.

The intended sequence is:

1.  Tilt the playing board using the two servo motors.
2.  Guide the ball into the funnel.
3.  Allow the ball to enter the return tube.
4.  Activate the blower.
5.  Blow the ball through the return tube toward its original elevated release position.
6.  Run the blower for a configured duration.
7.  Turn off the blower.
8.  Restore the playing board to its original level position.
9.  Wait for banker inspection.
10. Banker clicks CONFIRM READY.
11. Only then may the next drop proceed.

The blower run duration was discussed as approximately 5 seconds, but this is a tuning example rather than a finalized fixed duration.

## **5.3 Ball-return verification**

There is no automatic ball-return sensor.

The banker visually checks whether the ball has returned successfully.

The banker must press:

**CONFIRM READY**

This is required before another drop.

If the ball fails to return, the banker must be able to intervene manually.

## **5.4 Maintenance controls**

The banker dashboard will provide restricted manual hardware controls in Maintenance Mode.

These include:

  - Manual servo adjustment.
  - Manual blower activation.
  - Manual blower deactivation.
  - Hardware troubleshooting.

Maintenance Mode must not run concurrently with normal gameplay.

Hardware movement should have explicit time limits, safe operating ranges, and an emergency stop arrangement.

-----

# **6. CAMERA SYSTEM**

## **6.1 Camera source**

An Android smartphone serves as the overhead camera.

The smartphone streams camera video over the dedicated local Wi-Fi network to the Raspberry Pi.

The exact IP-camera application and video-streaming protocol have not been finalized.

## **6.2 Camera placement**

The camera is mounted overhead, facing the playing board.

It should capture all 16 cells and their borders.

Normal room lighting will be used.

There is no requirement to install dedicated illumination hardware.

## **6.3 Automatic lighting compensation**

The computer vision system should tolerate reasonable changes in room brightness.

Possible techniques include automatic exposure control where supported, brightness normalization, and robust thresholding.

The system should not depend on perfectly constant lighting.

## **6.4 Banker camera interface**

The banker dashboard will **not** continuously display a live camera feed during normal gameplay.

Instead, after the ball settles, it will display a **captured snapshot** showing the ball's final position.

The banker will use this snapshot to verify the detected cell and color.

This approach reduces bandwidth, interface clutter, and unnecessary visual processing.

## **6.5 Storage requirements**

Do not record or retain continuous video archives.

Avoid permanently storing unnecessary frame snapshots.

The Raspberry Pi has approximately 2.9 GB free storage, so transient image processing is preferred.

-----

# **7. CAMERA CALIBRATION**

## **7.1 Four-corner calibration**

The system will use the four corners of the physical playing board as its calibration reference points.

The calibration process establishes the board's image geometry.

Perspective correction or an equivalent coordinate transformation should map image positions into a normalized 4×4 grid.

## **7.2 Calibration ownership**

Camera calibration is accessible to the banker only.

Calibration can occur only while the game is idle, between rounds.

## **7.3 Calibration procedure**

The intended workflow:

1.  Banker enters calibration mode.
2.  Camera captures the board.
3.  Banker identifies or adjusts the four board corners.
4.  System calculates the grid mapping.
5.  System displays a calibration overlay.
6.  Banker places a test ball in a known cell.
7.  System detects that ball and predicts the cell.
8.  Banker verifies the prediction.
9.  If correct, calibration is saved.
10. If incorrect, calibration is retried.

The previous valid calibration must not be overwritten by a failed calibration attempt.

## **7.4 Calibration persistence**

The saved calibration must survive:

  - Normal application restarts.
  - Raspberry Pi reboots.
  - Banker logouts.

Recalibration is required if the board or camera moves enough to invalidate the mapping.

-----

# **8. COMPUTER VISION**

## **8.1 Detection principle**

The system detects the ball's location rather than visually recognizing the color underneath it.

The board's checkerboard color mapping is known in software.

Once the ball's cell is identified, the corresponding color is determined from the cell's predefined assignment.

For example:

Ball detected in cell 6 → BLACK.

Ball detected in cell 7 → YELLOW.

## **8.2 Ball detection**

The ball is expected to be light-colored against the board.

The vision system should:

1.  Obtain image frames.
2.  Apply the saved board calibration.
3.  Detect the ball.
4.  Estimate its location.
5.  Map it to a cell.
6.  Verify whether the ball has stopped moving.
7.  Decide whether the landing is valid or invalid.

Python with OpenCV is acceptable for computer vision, even though Node.js is the primary application platform.

## **8.3 Stationary detection rule**

The ball must remain stationary for:

**2 uninterrupted seconds**

If the ball moves during this period, the stationary timer resets.

Do not confirm the result based on one still frame.

## **8.4 Detection timeout**

The maximum detection time per drop attempt is:

**10 seconds**

If the system cannot produce a reliable result within 10 seconds, it must stop attempting and report a detection timeout.

## **8.5 Divider overlap rule**

An important later clarification supersedes our earlier strict divider rule.

A ball is NOT automatically invalid merely because part of its body touches or overlaps a grid divider.

The floor or board may not be perfectly level, so the ball could settle slightly against a stick.

A landing can still be considered valid if the ball is clearly located within one cell.

However, if the ball is balanced on a divider or its location between cells is genuinely ambiguous, the result is invalid.

The implementation should use a suitable ball-center or confidence-based approach and a reasonable geometric tolerance.

Do not implement an overly strict rule that rejects every ball whose visible outline touches a divider.

## **8.6 Invalid ball locations**

A result is invalid when:

  - The ball lands outside the valid board area.
  - The ball's cell cannot be determined confidently.
  - The ball is balanced ambiguously between cells.
  - Detection fails or confidence is inadequate.
  - The stationary condition is not met before the timeout.

The banker may resolve the situation through the established retry or cancellation controls.

## **8.7 Final image and detected result**

Once the system detects a potentially valid result:

  - Capture the final ball-position snapshot.
  - Determine the cell.
  - Determine BLACK or YELLOW.
  - Show the provisional result to the banker.
  - Show a provisional color indication to players.

The banker must still confirm the result before payouts occur.

-----

# **9. RESULT VERIFICATION**

## **9.1 Banker controls**

The banker has access to:

**RETRY SCAN**

**MANUAL COLOR CORRECTION**

**CONFIRM RESULT**

RETRY SCAN attempts to evaluate the current resting ball again.

MANUAL COLOR CORRECTION allows the banker to correct an inaccurate automatic result.

CONFIRM RESULT finalizes the winning color.

## **9.2 Provisional versus final results**

Players can see the automatically detected BLACK or YELLOW result before banker confirmation.

However, it must be clearly labeled as provisional.

The provisional result must not trigger payouts.

Only the banker-confirmed result is final.

## **9.3 Final result processing**

After CONFIRM RESULT:

1.  Server validates the round state.
2.  Final winning color is stored.
3.  Winning players receive payouts.
4.  Losing players receive no payouts.
5.  Round is marked settled.
6.  Player wallets update in real time.
7.  Automated ball recovery begins.

Settlement must be atomic and protected from duplicate execution.

-----

# **10. RETRY AND INVALID DROP HANDLING**

## **10.1 Timeout options**

If computer vision times out, the banker can choose:

  - RETRY SCAN.
  - RETRY DROP.
  - CANCEL ROUND.

## **10.2 Invalid landing options**

If the ball lands in an invalid position, the banker can:

  - Retry the drop.
  - Cancel the round.

Retrying a drop does not create a new betting round.

Existing confirmed bets remain associated with the round.

## **10.3 Retry drop recovery**

For a retry drop, the ball must first be physically recovered and returned to the release position.

The banker visually verifies the returned ball and presses CONFIRM READY.

Only then is another drop permitted.

## **10.4 Round cancellation**

If the banker cancels the round:

  - All confirmed bets for that round are refunded.
  - Refunded points return to their owners.
  - No winning payouts are issued.
  - The round is recorded as cancelled.
  - Players are notified.
  - Duplicate refunds are prevented.

-----

# **11. BETTING MECHANICS**

## **11.1 Betting choices**

Each player chooses exactly one color per round:

  - BLACK
  - YELLOW

## **11.2 Available wager amounts**

Only four betting amounts are allowed:

**5, 10, 15, or 20 points**

No arbitrary betting amounts.

## **11.3 Betting review**

A player can change their chosen amount and color before submitting the bet.

After pressing the initial CONFIRM BET control, the player sees a final review dialog.

The player must confirm their selection before the bet is placed.

## **11.4 Bet locking**

Once a bet is fully confirmed:

  - Its amount is deducted immediately.
  - It becomes locked for that round.
  - The player cannot change the amount.
  - The player cannot change the color.
  - The player cannot cancel the bet individually.

Round cancellation and other documented exceptional conditions may result in an automatic refund.

## **11.5 Insufficient balance**

Players may see and select all four wager amounts even if their balance is too low.

The server checks affordability when the player confirms the bet.

A bet exceeding the player's available balance is rejected.

## **11.6 One wager per player per round**

Each player may submit only one confirmed wager for a round.

Duplicate submissions must not cause multiple deductions.

-----

# **12. WINNING AND PAYOUT RULES**

A correct wager pays:

**2× the original wager, inclusive of the stake.**

Examples:

|  |  |  |
| :-: | :-: | :-: |
| \*\*Bet\*\* | \*\*Winning payout\*\* | \*\*Net gain\*\* |
| 5 | 10 | \\+5 |
| 10 | 20 | \\+10 |
| 15 | 30 | \\+15 |
| 20 | 40 | \\+20 |

Example:

Starting wallet = 100 points.

Player bets 20 points on BLACK.

Wallet immediately becomes 80 points.

If BLACK wins:

Add 40 points.

Final wallet = 120 points.

If YELLOW wins:

No additional points.

Final wallet = 80 points.

The original proposals involving three ball drops or a 4× payout are obsolete.

-----

# **13. ROUND MANAGEMENT**

## **13.1 Banker-controlled flow**

The banker manually starts each new round.

The banker manually closes betting.

The banker controls the ball drop and confirms the final result.

## **13.2 Basic round sequence**

A normal round proceeds through the following stages:

1.  Game idle.
2.  Banker starts round.
3.  Betting opens.
4.  Players confirm wagers.
5.  Banker closes betting.
6.  Banker drops ball.
7.  Computer vision tracks the ball.
8.  Ball is stationary for two uninterrupted seconds.
9.  System produces provisional result.
10. Banker verifies snapshot.
11. Banker confirms winning color.
12. Server settles bets.
13. Player balances update.
14. Board tilts to recover ball.
15. Blower returns the ball.
16. Board returns to its original position.
17. Banker confirms system ready.
18. Game is ready for another round.

## **13.3 Minimum betting participation**

The banker may drop the ball only if at least **one confirmed wager** exists.

Not every joined player is required to bet.

Players who do not bet may remain spectators.

## **13.4 Banker cancellation**

The banker can cancel an unfinished round.

Cancellation refunds all confirmed wagers exactly once.

The system must not reverse the payouts of a round that has already been successfully settled.

-----

# **14. PLAYER ACCOUNTS**

## **14.1 Player registration**

Players access the application through their smartphone browser.

They scan a QR code containing the Raspberry Pi's local web address.

New players register using a unique nickname.

No traditional player username/password login is required.

## **14.2 Nickname rules**

Nicknames must:

  - Be 3–12 characters long.
  - Contain only letters A–Z and numbers 0–9.
  - Contain no spaces.
  - Contain no special characters.
  - Be unique, ignoring letter case.

Example valid nicknames:

Christian

Player123

Mark05

Example invalid nicknames:

Jo

John Doe

Player@1

## **14.3 Duplicate nickname handling**

If a nickname is already registered, display:

**Nickname Already Taken**

The player must enter a different nickname.

Do not automatically generate replacement names.

Do not provide automatic nickname suggestions as a required feature.

## **14.4 Permanent nickname reservation**

Nicknames remain reserved even when:

  - A player disconnects.
  - A player becomes inactive.
  - A player leaves the game.

Only complete account deletion through the prototype's full reset allows the nickname to become available again.

## **14.5 Internal player identification**

The SQLite database should assign each account a stable internal player ID.

Nicknames are display identifiers, not the database's sole primary identifier.

## **14.6 Persistent sessions**

Players should normally remain recognized on the same browser/device after returning.

A persistent session links the browser to the existing player account.

Do not create a new account every time the page is refreshed or the player reconnects.

Use appropriately secure, unguessable session credentials.

Browser data loss or a change of device may require a separate account recovery process, which has not yet been finalized.

-----

# **15. ACTIVE PLAYER LIMIT**

## **15.1 Maximum capacity**

The system supports a maximum of:

**10 active players**

This is a prototype capacity limit.

The banker, camera device, and Raspberry Pi are not counted as player accounts.

## **15.2 Game full**

If ten active player slots are occupied, additional players cannot become active.

Show:

**Game Full**

Inactive accounts remain stored, but do not occupy active slots.

## **15.3 Disconnection timeout**

When an active player disconnects, the system allows a grace period of:

**2 continuous minutes**

If the player reconnects during that time, their active status is preserved.

If the disconnection exceeds two minutes, the account becomes inactive and its active slot becomes available.

## **15.4 Bets from disconnected players**

A disconnection must not invalidate an already confirmed bet.

If the player's wager wins, the winnings are credited even if that player is offline or inactive.

If the round is cancelled, the wager is refunded even if the player is offline.

-----

# **16. ACCOUNT REACTIVATION**

An inactive account retains:

  - Its nickname.
  - Its wallet.
  - Its transaction history.
  - Its stable internal ID.

Inactive players may view their wallet and latest available game result.

They cannot:

  - Place wagers.
  - Purchase points.
  - Redeem points.

They must request reactivation from the banker.

## **16.1 Reactivation approval**

Reactivation requests can be submitted while a game is active.

However, banker approval is allowed only between rounds.

## **16.2 Capacity enforcement**

If ten active slots are already occupied, new reactivation requests are immediately rejected.

If pending requests exist and the tenth slot becomes occupied, outstanding reactivation requests are automatically rejected according to the established capacity rule.

The backend must enforce the capacity limit atomically.

-----

# **17. NEW REGISTRATION TIMING**

New player registration is allowed only between rounds.

If an unregistered visitor accesses the application during an active round, show:

**Registration Temporarily Closed**

The page should automatically update when registration becomes available.

Socket.IO can handle this event without requiring the visitor to refresh manually.

Existing registered players can continue using their authorized sessions during active gameplay.

-----

# **18. LEAVE GAME**

Players have a:

**LEAVE GAME**

button.

## **18.1 Confirmation dialog**

Pressing LEAVE GAME must open a final confirmation dialog explaining the consequences.

The player must explicitly confirm before submitting the exit.

The dialog should explain:

  - The wallet balance is preserved.
  - Account and transaction records are preserved.
  - Pending point requests will be cancelled.
  - Reserved points associated with pending redemptions will be released.
  - Returning to the game will require banker reactivation approval.
  - If a round is in progress, the exit will be completed only after the round finishes.

## **18.2 Leaving between rounds**

If the game is idle:

  - The player is deactivated.
  - Their active slot is freed.
  - Their wallet remains stored.
  - Their nickname remains reserved.
  - Pending point requests are cancelled.

## **18.3 Leaving during an active round**

If the player requests to leave during an active round:

  - The exit is queued.
  - Any confirmed bet remains valid.
  - The player cannot place further bets.
  - The player waits until settlement or cancellation.
  - Payouts or refunds are processed normally.
  - Then the account is deactivated.

## **18.4 Cancellation of pending point requests**

Pending purchases and redemptions are automatically cancelled when the player's exit is finalized.

Reserved points must be released correctly.

A pending redemption must never permanently lock points after the player leaves.

-----

# **19. POINTS SYSTEM**

## **19.1 Currency**

The game uses virtual points.

For demonstration purposes:

**1 virtual point = ₱1 of fictional prop currency.**

This is not real money.

## **19.2 Point sources**

Players may obtain points from:

1.  Banker-approved prop-money top-ups.
2.  Complimentary starting credits.
3.  Winning wagers.
4.  Refunds from cancelled rounds.

## **19.3 Unified balance**

All virtual points are fungible.

The wallet does not require separate spendable balances for complimentary, purchased, and winning points.

However, transaction records should identify the source of each credit.

## **19.4 Redemption eligibility**

ALL virtual points may be redeemed for prop money.

This includes:

  - Complimentary starting points.
  - Purchased points.
  - Winnings.
  - Refunded points.

No restrictions based on point origin.

-----

# **20. STARTING BALANCE**

## **20.1 Banker configurable**

The banker determines how many complimentary points a newly registered player receives.

Allowed range:

**0 to 100 points**

Increment:

**5 points**

Examples:

0, 5, 10, 15, 20, 25 ... 100.

## **20.2 Configuration timing**

The banker can change the configured starting balance **only between rounds**.

## **20.3 Effect on existing accounts**

Changing the starting balance affects future registrations only.

Existing players' wallet balances must not be overwritten or adjusted retroactively.

Example:

Christian registers when the configured starting balance is 20.

Christian receives 20 points.

Later, the banker changes the starting balance to 50.

Christian retains his wallet.

New accounts created afterward receive 50 points.

## **20.4 Database logging**

Starting credits should be recorded distinctly from point purchases.

For example:

Transaction type: STARTING\_CREDIT

The initial default value before the banker changes the setting is not yet explicitly fixed.

-----

# **21. POINT PURCHASES**

## **21.1 Purchase amounts**

Players may request point purchases using prop money.

Each individual purchase request must be:

  - At least 5 points.
  - At most 100 points.
  - A multiple of 5.

## **21.2 Wallet capacity**

There is **no maximum total wallet balance**.

The 100-point restriction applies to each purchase transaction, not the total accumulated wallet balance.

Do not reintroduce earlier 100-point or 1,000-point total wallet limits.

## **21.3 Purchase workflow**

1.  Player opens Point Store.
2.  Player selects purchase amount.
3.  Player submits request.
4.  Request becomes pending.
5.  Banker sees request in pending list.
6.  Banker verifies prop-money exchange.
7.  Banker approves or rejects request.
8.  If approved, points are credited immediately.
9.  Player wallet and request status update in real time.

## **21.4 Request limitations**

A player may have at most one pending point transaction at a time.

The pending transaction may be either a purchase or a redemption.

They cannot maintain simultaneous pending purchase and redemption requests.

-----

# **22. POINT REDEMPTIONS**

## **22.1 Redemption amounts**

Players may request redemption in positive multiples of 5.

The requested amount cannot exceed their available wallet balance.

There is no separate confirmed redemption maximum beyond the available balance and multiples-of-5 requirement.

## **22.2 Redemption reservations**

When a redemption is submitted, the requested points must be reserved so they cannot also be wagered or redeemed again.

The system must distinguish available points from points reserved for pending redemption.

## **22.3 Redemption workflow**

1.  Player requests redemption.
2.  Server validates and reserves the points.
3.  Request enters pending state.
4.  Banker receives it in the pending-request list.
5.  Banker handles the prop-money exchange.
6.  Banker approves, rejects, or cancels.
7.  On approval, the redemption is finalized.
8.  On rejection or cancellation, reserved points become available again.
9.  Player sees the updated status and wallet.

## **22.4 Prop-money inventory**

The system will **not** track physical prop-money inventory.

The banker handles any shortages manually.

Do not build a prop-money inventory subsystem unless specifically requested later.

-----

# **23. POINT REQUEST ADMINISTRATION**

## **23.1 Banker permissions**

Only the banker may:

  - Approve requests.
  - Reject requests.
  - Cancel requests.

Players may submit requests, but cannot manually cancel their own pending point requests.

An exception is account exit, which automatically cancels pending point requests.

## **23.2 Banker interface**

The banker sees a list of pending point transactions.

There should be **no required notification badge, popup, toast, or sound** for new pending requests on the banker dashboard.

The banker can simply inspect the pending-request list.

## **23.3 Processing during rounds**

Point purchases and redemptions are allowed only between rounds.

Requests that remain pending when a round begins are held until the appropriate between-round period.

The implementation must not approve or finalize banker-mediated point transactions during active gameplay.

## **23.4 Player status information**

The player sees the following information about their request:

  - Request type.
  - Amount.
  - Status.

Possible statuses:

PENDING

APPROVED

REJECTED

CANCELLED

-----

# **24. DUPLICATE TRANSACTION PROTECTION**

The banker can accidentally click APPROVE more than once.

A slow Wi-Fi connection may also lead to retries or repeated submissions.

The system must prevent duplicate credits or debits.

## **24.1 Frontend protection**

The APPROVE button becomes disabled while a transaction is processing.

## **24.2 Backend protection**

Each transaction must have a unique identifier.

The server verifies that a transaction remains PENDING before approving it.

A request that has already been approved, rejected, or cancelled cannot be approved again.

## **24.3 Database protection**

Approval and wallet modification must be executed atomically using SQLite transactions.

Two simultaneous approval attempts must not both change the wallet.

On reconnect or frontend timeout, the dashboard must retrieve the authoritative status from the server.

## **24.4 Example**

Player requests 50 points.

Banker accidentally clicks APPROVE twice.

Expected result:

Only 50 points are credited.

Never 100.

This principle also applies to:

  - Bet deductions.
  - Payouts.
  - Round refunds.
  - Redemption reservations.
  - Redemption approval.
  - Starting credits.

-----

# **25. TRANSACTION NOTIFICATIONS**

## **25.1 Player notifications**

Players receive brief confirmation messages when point requests are:

  - Approved.
  - Rejected.
  - Cancelled.

## **25.2 Duration**

Each notification disappears automatically after:

**5 seconds**

## **25.3 Behavior**

Notifications should be:

  - Small.
  - Non-blocking.
  - Visible on the player's smartphone.
  - Delivered in real time where connected.
  - Silent.

No notification sounds.

## **25.4 Examples**

Top-up approved:

"50 Points Added Successfully"

Top-up rejected:

"Top-Up Request Rejected"

Redemption approved:

"50 Points Redeemed Successfully"

Redemption rejected:

"Redemption Request Rejected"

Request cancelled:

"Point Request Cancelled"

After the message disappears, the current transaction status must remain accessible through the player's wallet interface.

-----

# **26. PLAYER DASHBOARD**

The smartphone player interface should be simple, responsive, and mobile-friendly.

It must show the information necessary for gameplay without exposing other players' information.

## **26.1 Main information**

  - Player nickname.
  - Current virtual wallet balance.
  - Current round state.
  - Whether betting is open or closed.
  - BLACK and YELLOW selections.
  - Allowed bet amounts.
  - Current confirmed bet.
  - Latest round result.
  - Point Store controls.
  - Current pending point request and status.
  - Leave Game control.

## **26.2 Betting interface**

Players can select:

BLACK or YELLOW.

Then:

5, 10, 15, or 20 points.

They review the wager before final confirmation.

Once confirmed, the bet becomes locked.

## **26.3 Provisional result**

After vision detection but before banker confirmation, show a small result indicator.

It must be clearly labeled provisional or awaiting confirmation.

Avoid large intrusive splash screens.

## **26.4 Final result**

After banker confirmation, update the winning color and wallet balance.

Display appropriate visual feedback.

## **26.5 Privacy**

Players must NOT see:

  - Other players' wager amounts.
  - Other players' selected colors.
  - Other players' balances.
  - The total number of players who confirmed bets, if this reveals other players' participation.

The banker is allowed to view those details.

## **26.6 No player history page**

Players do not need a full historical transaction page.

The banker maintains the complete administrative ledger.

Players need only the current wallet, current bet, latest result, and the status of their relevant pending point request.

-----

# **27. BANKER DASHBOARD**

The banker is the main game operator and administrator.

## **27.1 Authentication**

The banker logs in using:

  - Administrator username.
  - Password.

Store the password as a secure salted hash, never plaintext.

Banker authentication must be separate from ordinary player sessions.

## **27.2 Game controls**

The banker needs controls for:

  - START ROUND.
  - CLOSE BETTING.
  - DROP.
  - RETRY SCAN.
  - MANUAL COLOR CORRECTION.
  - CONFIRM RESULT.
  - RETRY DROP.
  - CANCEL ROUND.
  - CONFIRM READY.
  - STOP.

Only display or enable controls appropriate to the current round state.

## **27.3 Player administration**

The banker can:

  - View active players.
  - View inactive players.
  - View individual wallets.
  - Inspect confirmed wagers.
  - Approve reactivation.
  - Deactivate players.
  - Monitor the maximum-ten-player capacity.

## **27.4 Point administration**

The banker can:

  - View pending top-ups.
  - View pending redemptions.
  - Approve requests.
  - Reject requests.
  - Cancel requests.
  - View transactions.

## **27.5 Settings**

The banker can:

  - Configure starting points between rounds.
  - Perform camera calibration when idle.
  - Enter Maintenance Mode when permitted.
  - Perform protected prototype resets.

## **27.6 Camera output**

The banker sees a captured image of the ball's final resting location.

A continuous live camera feed is not required for the normal gameplay dashboard.

-----

# **28. EMERGENCY STOP**

The banker has a STOP control.

STOP must put gameplay into a safe halted state and cancel an unfinished round.

## **28.1 Financial handling**

If a round is unfinished:

  - Confirmed bets are refunded exactly once.
  - Unsettled wagers are cancelled.

If settlement has already completed successfully:

  - Previously awarded payouts must not be undone simply because STOP was pressed afterward.

## **28.2 Hardware handling**

The system should stop actuators safely.

A physical emergency motor-power cutoff should exist independently of the web interface.

Do not rely exclusively on software for electrically or mechanically dangerous conditions.

## **28.3 Recovery**

After emergency handling, banker inspection and system readiness confirmation are required before normal gameplay resumes.

-----

# **29. ERROR HANDLING AND RECOVERY**

The system must handle failures without duplicating credits, losing committed wallet data, or silently proceeding in an unsafe state.

## **29.1 Camera disconnection**

If the camera becomes unavailable during an unfinished round:

  - Automatically cancel the unfinished round.
  - Refund all confirmed bets.
  - Inform the banker and connected players.
  - Do not proceed with another drop until the camera and system are ready.

## **29.2 Wi-Fi hotspot disconnection**

If the critical hotspot connection is lost:

  - Cancel unfinished rounds when the server detects the outage.
  - Refund confirmed wagers.
  - Preserve wallet data in SQLite.
  - Require system readiness verification after connectivity returns.

A phone hotspot going offline does not necessarily mean the Raspberry Pi process crashes; detection must be implemented explicitly.

## **29.3 Node.js server crash**

The Node.js service will be configured to restart automatically using systemd.

On restart after an unexpected process failure:

  - Inspect the persisted round state.
  - Safely cancel/refund unfinished rounds.
  - Preserve already settled transactions.
  - Invalidate the banker's previous session.
  - Require banker login.
  - Require system inspection and readiness confirmation.

The exact crash-recovery transaction protocol must be designed so an already committed settlement is never mistaken for an unfinished round.

## **29.4 Normal power loss**

Normal power loss is treated differently from a detected application crash.

After restoration:

  - Persistent wallets and transaction records remain intact.
  - The banker reviews the interrupted round.
  - The banker chooses whether to resume or cancel when resumption is safe and technically possible.
  - Hardware readiness is checked before actuators are enabled.

The next AI should define a reliable method for distinguishing recoverable interrupted rounds from crash-recovery cancellation cases.

## **29.5 System startup checks**

At startup, the system should check available software and hardware interfaces.

Before the operator begins gameplay, the banker must press:

**CONFIRM SYSTEM READY**

after physically inspecting the setup.

This confirmation is separate from CONFIRM READY used after ball recovery, although the interface may share design conventions.

-----

# **30. DATA STORAGE**

## **30.1 Database**

**SQLite**

The database stores persistent project data.

## **30.2 Required stored information**

At minimum:

  - Players.
  - Nicknames.
  - Account active/inactive state.
  - Player wallet balances.
  - Reserved redemption points.
  - Banker account.
  - Banker sessions.
  - Player sessions or session credentials.
  - Game rounds.
  - Round states.
  - Bets.
  - Detected results.
  - Confirmed results.
  - Payouts.
  - Refunds.
  - Point purchases.
  - Point redemptions.
  - Starting balance credits.
  - Pending reactivation requests.
  - Camera calibration.
  - Application settings.
  - Relevant recovery records.

## **30.3 Transaction history**

The banker requires full financial-style audit records for all virtual point movement.

Transaction categories should distinguish:

  - STARTING\_CREDIT
  - POINT\_PURCHASE
  - POINT\_REDEMPTION
  - BET\_DEBIT
  - WIN\_PAYOUT
  - ROUND\_REFUND
  - ADMIN\_RESET or equivalent audit records when meaningful

## **30.4 Database integrity**

Critical balance changes must use SQLite transactions.

All monetary values are integer points, not floating-point peso values.

Enforce uniqueness where appropriate.

Use foreign keys and database constraints.

Design payout and refund operations to be idempotent.

A valid already-processed transaction must not be processed again.

-----

# **31. PROTOTYPE RESET MODES**

The banker has two reset modes.

Both are restricted administrator actions and require password confirmation.

## **31.1 Reset mode A — Points and history**

Reset player balances and transaction history for demonstration purposes.

Retain:

  - Player accounts.
  - Nicknames.
  - Account/session identity according to the confirmed retention requirement.
  - Banker account.
  - Relevant hardware and application settings.

This is not a complete account deletion.

## **31.2 Reset mode B — Complete player reset**

Delete all player accounts and associated player information.

This includes:

  - Player nicknames.
  - Wallet balances.
  - Player bets.
  - Player transaction history.
  - Player sessions.
  - Player-specific activity data.

Retain:

  - Banker account.
  - Appropriate device settings.
  - Hardware calibration and configuration unless specifically selected otherwise.

After a complete player reset, previously registered nicknames become available again.

## **31.3 Reset precautions**

Resets should occur only when gameplay is idle and there are no unresolved financial operations.

Require the banker password.

A database backup before reset is strongly recommended.

-----

# **32. NETWORK ARCHITECTURE**

## **32.1 Dedicated hotspot**

The game runs on a dedicated Android smartphone hotspot.

No internet connection is required during gameplay.

## **32.2 Device roles**

There are three distinct smartphone roles:

1.  Hotspot phone.
2.  Overhead camera phone.
3.  Banker phone.

Player phones connect separately.

The hotspot phone and camera phone are **not the same device**.

## **32.3 Maximum hotspot clients**

Potential network participants:

  - 10 player smartphones.
  - 1 banker smartphone.
  - 1 overhead camera smartphone.
  - 1 Raspberry Pi.

Maximum expected simultaneous clients:

**13 network clients**

The Android hotspot must support this many connections.

This has not yet been hardware-verified.

The next AI should flag client capacity and client-to-client connectivity as early practical tests.

## **32.4 Local access**

The Raspberry Pi hosts the web server on its local network address.

Players open the application via QR code.

A typical address format is:

http://RASPBERRY\_PI\_LOCAL\_IP

The actual IP and port will be configured later.

The Raspberry Pi's local address may change when reconnecting to the hotspot, so the QR code must reflect its current reachable address.

## **32.5 Client isolation concern**

Some Android hotspots may prevent connected clients from directly communicating with one another.

Because the camera and phones must communicate with the Raspberry Pi, this needs to be tested on the actual hotspot phone.

Do not assume all Android hotspots support the required 13 clients and local client-to-client traffic.

-----

# **33. SOFTWARE STACK**

## **33.1 Primary language**

**Node.js / JavaScript**

Node.js is the main application platform.

## **33.2 Backend**

A lightweight Node.js server, with Express as a suitable choice.

Responsibilities:

  - Serve the web application.
  - Authenticate the banker.
  - Manage player sessions.
  - Register accounts.
  - Enforce game states.
  - Validate bets.
  - Update wallets.
  - Manage administrative actions.
  - Handle point requests.
  - Communicate with the vision component.
  - Control hardware through suitable drivers or subprocesses.
  - Persist state in SQLite.

## **33.3 Real-time communication**

**Socket.IO**

Used for:

  - Betting availability.
  - Round status updates.
  - Provisional results.
  - Confirmed results.
  - Wallet updates.
  - Transaction notifications.
  - Registration availability.
  - Player connection status.
  - Banker dashboard updates.
  - Recovery and error states.

The server is authoritative.

Players cannot change wallet balances or declare results by emitting arbitrary frontend events.

## **33.4 Frontend**

Use standard:

  - HTML.
  - CSS.
  - JavaScript.

Keep the interface mobile-friendly.

Avoid unnecessary large frontend frameworks.

There should be separate player and banker interfaces with enforced backend permissions.

## **33.5 Computer vision**

Python and OpenCV are permitted for the vision subsystem.

Possible integration:

Node.js communicates with a persistent Python vision worker.

Avoid spawning a fresh heavyweight Python process for every camera frame.

## **33.6 Hardware utilities**

Specialized hardware drivers or helper programs may use another language if necessary.

Keep Node.js as the main application controller.

## **33.7 Operating system integration**

Use systemd to launch and restart the main application on Raspberry Pi startup.

Configure logging and restart behavior carefully.

## **33.8 Storage efficiency**

Given approximately 2.9 GB free storage:

  - Prefer lightweight packages.
  - Avoid unnecessary large dependencies.
  - Disable large debug output.
  - Rotate logs.
  - Avoid continuous video recording.
  - Avoid accumulating unnecessary snapshots.
  - Use a persistent vision process if needed.
  - Monitor disk usage.

-----

# **34. GPIO AND ELECTRICAL SAFETY**

The Raspberry Pi GPIO pins cannot directly power substantial servo or blower loads.

The next AI must design hardware interfacing appropriately.

## **34.1 Servos**

Use a suitable external power supply for servos.

Share appropriate signal reference grounds where needed.

Avoid damaging the Raspberry Pi through motor current surges or poor power wiring.

## **34.2 Blower**

Use a correctly rated switching or motor driver circuit.

Do not connect a motor directly to a GPIO pin.

Ensure appropriate flyback, surge, and power-management protection for the selected motor type.

## **34.3 Emergency stop**

A physical emergency motor-power cutoff is recommended as part of the prototype's safety architecture.

## **34.4 Startup behavior**

Servo and blower outputs must default to safe states.

Do not actuate motors unexpectedly during startup, restart, or a system crash.

-----

# **35. CRITICAL STATE MANAGEMENT**

The game should use an explicit finite-state machine.

A proposed state progression is:

IDLE

BETTING\_OPEN

BETTING\_CLOSED

DROP\_IN\_PROGRESS

DETECTING

AWAITING\_RESULT\_CONFIRMATION

SETTLING

BALL\_RECOVERY

AWAITING\_BALL\_READY\_CONFIRMATION

READY

ERROR

CANCELLED

MAINTENANCE

HALTED

These labels are suggested implementation names, not previously fixed API constants.

The architect may choose better names provided the confirmed behavior is preserved.

## **35.1 Server authority**

Every action must validate the current state.

Examples:

  - Cannot drop while betting is open.
  - Cannot drop with zero confirmed bets.
  - Cannot place bets after betting closes.
  - Cannot settle the same round twice.
  - Cannot approve point requests during an active round.
  - Cannot calibrate while the ball is dropping.
  - Cannot start another round during ball recovery.
  - Cannot operate normal gameplay and Maintenance Mode simultaneously.

## **35.2 Race conditions**

Special attention should be given to:

  - Simultaneous bet confirmation.
  - Player disconnect during settlement.
  - Banker double-clicking controls.
  - Redemption reservation and bet deduction.
  - Player exit during a round.
  - Account deactivation with outstanding bets.
  - Simultaneous reactivation approvals near the ten-player limit.
  - Process crashes during wallet updates.
  - Reconnection after missed Socket.IO events.

-----

# **36. USER EXPERIENCE PREFERENCES**

The interface should be simple and functional rather than overdesigned.

Important preferences:

  - Mobile-first player interface.
  - Banker-focused operational dashboard.
  - No gameplay sounds.
  - No unnecessary popup notifications on the banker dashboard.
  - Pending point transactions displayed as a list.
  - Five-second nonblocking transaction notifications for players.
  - Small provisional and final result indicators.
  - Clear confirmation dialogs for significant actions.
  - Clear error messages.
  - Real-time updates rather than requiring manual refresh.
  - Minimal network and processor overhead.

-----

# **37. SUPERSEDED REQUIREMENTS — DO NOT REVIVE**

This section is particularly important because many requirements changed during the discussion.

|  |  |
| :-: | :-: |
| \*\*Earlier concept\*\* | \*\*FINAL requirement\*\* |
| Black versus Red | Black versus Yellow |
| Multiple balls | Exactly one ball |
| Three ball drops per round | One ball drop per round |
| 4× payout | 2× wager, inclusive of stake |
| Ball pockets/holes | Flat grid with low sticks/dividers |
| Strictly reject any divider contact | Accept if clearly positioned in one cell |
| Detect the underlying color directly | Detect ball position and map cell to color |
| Banker always watches continuous video | Banker reviews a final-position snapshot |
| Fully automatic ball-ready detection | Banker manually presses CONFIRM READY |
| Maximum total wallet balance | No total wallet maximum |
| Fixed starting point balance | Banker-configurable 0–100, increments of 5 |
| Starting points restricted from redemption | All point origins are redeemable |
| Automatic nickname reuse after deactivation | Nicknames remain reserved |
| Automatic nickname suggestions | Show duplicate error; player chooses another |
| Free-form nicknames | 3–12 alphanumeric characters |
| No exit confirmation | LEAVE GAME requires a final dialog |
| Transaction message remains indefinitely | Message automatically disappears after 5 seconds |
| Physical prop-money inventory tracking | No inventory tracking |

The next AI must prioritize these final decisions.

-----

# **38. IMPORTANT ENGINEERING DETAILS TO ADDRESS**

The following are design recommendations or topics requiring technical resolution, rather than completely finalized implementation decisions.

## **38.1 Camera streaming protocol**

Select a reliable, low-overhead approach for streaming Android camera video to the Raspberry Pi.

The chosen app and protocol must work without internet.

## **38.2 Actual available storage**

Verify operating system version, installed packages, current disk usage, and whether Python/OpenCV is already installed before choosing installation procedures.

Do not assume there is room for a large dependency bundle.

## **38.3 Camera-to-board geometry**

Implement four-corner perspective mapping and a practical ball-position confidence rule.

Choose thresholds experimentally with real images.

## **38.4 Motion detection**

Define a robust two-second stationary criterion based on image coordinates and noise tolerance.

The threshold is not yet physically calibrated.

## **38.5 Recovery motor timing**

Determine safe servo angles, travel limits, and blower duration after physical testing.

The five-second blower value is only an initial example.

## **38.6 Server-to-Python communication**

Choose an IPC mechanism such as a lightweight local socket or persistent subprocess messaging.

The contract must report ball detection, confidence, timeout, and status reliably.

## **38.7 Database migrations**

Provide a maintainable SQLite schema and migration strategy.

Avoid destructive database recreation during normal application updates.

## **38.8 Session recovery**

Persistent players must be identified securely.

The user-facing recovery procedure if a player clears browser storage or switches devices has not been finalized.

## **38.9 Default starting balance**

The allowed range is finalized, but the initial factory-default starting balance has not been explicitly selected.

## **38.10 Power loss versus crash recovery**

The implementation must preserve the stated distinction:

  - Unexpected Node.js crash → cancel/refund unfinished round after restart.
  - Normal power-loss recovery → banker may assess safe resumption or cancellation.

A robust, implementable way to distinguish and manage these scenarios requires careful design.

## **38.11 Fairness and board bias**

The board has an equal number of BLACK and YELLOW cells, but this alone does not guarantee equal real-world landing probabilities.

The physical release position, divider geometry, and levelness may bias outcomes.

Run repeated trial drops to assess whether the prototype behaves acceptably.

## **38.12 Hotspot capacity**

Confirm the Android hotspot supports thirteen connected devices and allows their local communication.

This is a significant deployment dependency.

-----

# **39. EXPECTED END PRODUCT**

The end product should be a working prototype where:

1.  The Raspberry Pi boots and launches the application automatically.
2.  Banker logs into the administrator dashboard.
3.  Banker verifies camera and hardware readiness.
4.  Banker configures starting credits if necessary.
5.  Players scan a local QR code.
6.  Players register unique nicknames.
7.  Players receive their configured starting points.
8.  Players may purchase or redeem points through banker approval.
9.  Banker opens a betting round.
10. Players select BLACK or YELLOW and wager 5, 10, 15, or 20 points.
11. Confirmed wagers are deducted.
12. Banker closes betting.
13. Banker presses DROP.
14. Servo releases the physical ball.
15. Computer vision observes the board.
16. Ball settles for two uninterrupted seconds.
17. System determines the cell and preliminary color.
18. Banker checks the final-position snapshot.
19. Banker confirms or corrects the result.
20. Server distributes winning payouts.
21. Player balances update over Socket.IO.
22. Servo motors tilt the board.
23. Ball reaches the funnel and return tube.
24. Blower returns the ball toward the original release point.
25. Board returns to its original position.
26. Banker visually verifies the ball.
27. Banker presses CONFIRM READY.
28. The game is ready for another round.

The prototype must also handle cancellations, retries, player disconnections, and service restarts safely.

-----

# **40. HOW THE NEXT AI SHOULD HELP**

I want the next AI to continue this project from the specifications above.

Please follow these expectations:

1.  Do not start over with fundamental questions already answered.
2.  Do not silently change established requirements.
3.  Identify technical contradictions or implementation risks when they arise.
4.  Provide clear, practical engineering guidance.
5.  Prefer lightweight implementations suitable for Raspberry Pi 5.
6.  Explain the purpose of each software module before introducing unnecessary complexity.
7.  Design the database and state machine carefully before writing financial/gameplay transaction code.
8.  Separate actual hardware controls from simulated controls.
9.  Use testable modules and incremental integration.
10. Provide executable setup instructions when implementation begins.
11. Include meaningful error handling.
12. Keep deployment fully functional on a local offline hotspot.
13. Remember this is a classroom prototype using fictional points and prop money.
14. Avoid adding elaborate features not requested.
15. Help move the project toward an operational physical demonstration rather than indefinitely extending requirements gathering.

-----

# **41. RECOMMENDED IMPLEMENTATION ROADMAP**

The following sequence is a recommendation for the next development phase.

## **Phase 1 — Hardware and environment audit**

Inspect:

  - Raspberry Pi OS version.
  - Node.js version.
  - Python version.
  - Existing installed dependencies.
  - Available disk storage.
  - Hotspot connectivity.
  - Camera-stream accessibility.
  - Hardware driver choices.

## **Phase 2 — Backend foundation**

Create:

  - Node.js application.
  - Express server.
  - SQLite database.
  - Banker authentication.
  - Player registration.
  - Persistent player sessions.
  - Basic mobile web interface.
  - Socket.IO connectivity.

## **Phase 3 — Wallet and points**

Implement:

  - Starting credits.
  - Top-up requests.
  - Redemption requests.
  - Reservation handling.
  - Banker approvals.
  - Atomic wallet updates.
  - Transaction logs.
  - Five-second notifications.

## **Phase 4 — Software-only gameplay**

Implement a simulated ball result before integrating hardware.

Test:

  - Round creation.
  - Betting.
  - Bet locking.
  - Wager deductions.
  - Payouts.
  - Refunds.
  - Cancellation.
  - Reconnection.
  - Duplicate submission protection.

## **Phase 5 — Camera integration**

Implement:

  - Android phone stream.
  - Board calibration.
  - Ball identification.
  - Grid-cell mapping.
  - Stationary detection.
  - Detection timeout.
  - Final snapshots.
  - Banker result confirmation.

## **Phase 6 — Servo and blower control**

Integrate:

  - Ball release.
  - Board tilting.
  - Return blower.
  - Manual maintenance controls.
  - Physical readiness confirmation.

## **Phase 7 — Full workflow integration**

Connect the real ball-detection output to live game settlement and automatic recovery.

## **Phase 8 — Reliability tests**

Test:

  - Sudden player disconnections.
  - Camera loss.
  - Hotspot loss.
  - Unexpected Node.js termination.
  - Power interruption.
  - Duplicate approval clicks.
  - Duplicate bet submissions.
  - Failed returns.
  - Invalid ball positions.
  - Emergency stop.
  - Ten simultaneous active players.
  - Disk usage during prolonged operation.

-----

# **42. PROJECT STATUS AT TRANSFER**

The previous discussion concluded with:

**Question 125: How long should point transaction notifications remain visible?**

My final answer was:

"Transaction notifications will automatically disappear after 5 seconds."

This decision was confirmed.

The previous AI then offered four next steps:

A. Consolidate requirements.

B. Design software architecture.

C. Start programming.

D. Continue gathering requirements.

I chose to prepare a complete handoff for another AI.

**The next intended phase is project architecture and implementation, not another 125-question requirements interview.**

END OF HANDOFF DOCUMENT.

  