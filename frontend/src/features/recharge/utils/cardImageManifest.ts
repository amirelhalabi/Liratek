/**
 * Card artwork per mobile-service item, keyed `category|subcategory|label`
 * (lower-cased; labels normalised by `normaliseLabel` in cardImages.ts).
 *
 * The artwork is the provider's own product card as shown in the Whish app
 * (crawled 2026-10-14, see docs/whish-prices/), matched to catalog items by
 * product and denomination. Keys do not include the provider: iPick, Katsh
 * and WHISH_APP sell the same physical card, so they share one image.
 * Items with no matching card are simply absent.
 */
import cardAlfa15P15 from "@/assets/cards/alfa-15.15.jpg";
import cardAlfa22P73 from "@/assets/cards/alfa-22.73.jpg";
import cardAlfa3P03 from "@/assets/cards/alfa-3.03.jpg";
import cardAlfa7P58 from "@/assets/cards/alfa-7.58.jpg";
import cardAlfa77P28 from "@/assets/cards/alfa-77.28.jpg";
import cardAlfaAlfaGoAlfaGoMax from "@/assets/cards/alfa-alfa-go-alfa-go-max.jpg";
import cardAlfaAlfaGoAlfaGoPlus from "@/assets/cards/alfa-alfa-go-alfa-go-plus.jpg";
import cardAlfaAlfaGoAlfaGo from "@/assets/cards/alfa-alfa-go-alfa-go.jpg";
import cardAlfaBoosters20Mins from "@/assets/cards/alfa-boosters-20mins.jpg";
import cardAlfaBoosters50Mb from "@/assets/cards/alfa-boosters-50mb.jpg";
import cardAlfaBoosters600Mb from "@/assets/cards/alfa-boosters-600mb.jpg";
import cardAlfaBoostersUnlinmited2Hrs from "@/assets/cards/alfa-boosters-unlinmited-2hrs.jpg";
import cardAlfaMobileBroadband111Gb from "@/assets/cards/alfa-mobile-broadband-111gb.jpg";
import cardAlfaMobileBroadband1Gb from "@/assets/cards/alfa-mobile-broadband-1gb.jpg";
import cardAlfaMobileBroadband22Gb from "@/assets/cards/alfa-mobile-broadband-22gb.jpg";
import cardAlfaMobileBroadband444Gb from "@/assets/cards/alfa-mobile-broadband-444gb.jpg";
import cardAlfaMobileBroadband44Gb from "@/assets/cards/alfa-mobile-broadband-44gb.jpg";
import cardAlfaMobileBroadband77Gb from "@/assets/cards/alfa-mobile-broadband-77gb.jpg";
import cardAlfaMobileBroadband7Gb from "@/assets/cards/alfa-mobile-broadband-7gb.jpg";
import cardAlfaMobileInternet111Gb from "@/assets/cards/alfa-mobile-internet-111gb.jpg";
import cardAlfaMobileInternet1Gb from "@/assets/cards/alfa-mobile-internet-1gb.jpg";
import cardAlfaMobileInternet22Gb from "@/assets/cards/alfa-mobile-internet-22gb.jpg";
import cardAlfaMobileInternet444Gb from "@/assets/cards/alfa-mobile-internet-444gb.jpg";
import cardAlfaMobileInternet44Gb from "@/assets/cards/alfa-mobile-internet-44gb.jpg";
import cardAlfaMobileInternet77Gb from "@/assets/cards/alfa-mobile-internet-77gb.jpg";
import cardAlfaMobileInternet7Gb from "@/assets/cards/alfa-mobile-internet-7gb.jpg";
import cardAlfaMobileInternetPostpaid120Gb from "@/assets/cards/alfa-mobile-internet-postpaid-120gb.jpg";
import cardAlfaMobileInternetPostpaid1Gb from "@/assets/cards/alfa-mobile-internet-postpaid-1gb.jpg";
import cardAlfaMobileInternetPostpaid25Gb from "@/assets/cards/alfa-mobile-internet-postpaid-25gb.jpg";
import cardAlfaMobileInternetPostpaid475Gb from "@/assets/cards/alfa-mobile-internet-postpaid-475gb.jpg";
import cardAlfaMobileInternetPostpaid50Gb from "@/assets/cards/alfa-mobile-internet-postpaid-50gb.jpg";
import cardAlfaMobileInternetPostpaid7Gb from "@/assets/cards/alfa-mobile-internet-postpaid-7gb.jpg";
import cardAlfaMobileInternetPostpaid85Gb from "@/assets/cards/alfa-mobile-internet-postpaid-85gb.jpg";
import cardAlfaPrepaid1P22 from "@/assets/cards/alfa-prepaid-1.22.jpg";
import cardAlfaPrepaid10 from "@/assets/cards/alfa-prepaid-10.jpg";
import cardAlfaPrepaid4P5 from "@/assets/cards/alfa-prepaid-4.5.jpg";
import cardAlfaSurfAndTalk4X4 from "@/assets/cards/alfa-surf-and-talk-4x4.jpg";
import cardAlfaSurfAndTalk5X5 from "@/assets/cards/alfa-surf-and-talk-5x5.jpg";
import cardAlfaWeekenderTheWeekender from "@/assets/cards/alfa-weekender-the-weekender.jpg";
import cardAlfaWeeklyData1P5Gb from "@/assets/cards/alfa-weekly-data-1.5gb.jpg";
import cardAlfaWeeklyData500Mb from "@/assets/cards/alfa-weekly-data-500mb.jpg";
import cardAlfaWeeklyData5Gb from "@/assets/cards/alfa-weekly-data-5gb.jpg";
import cardGamingApexApex20UsaPcOnly from "@/assets/cards/gaming-apex-apex-20-usa-pc-only.jpg";
import cardGamingArenaBreakoutArenaBreakout1 from "@/assets/cards/gaming-arena-breakout-arena-breakout-1.jpg";
import cardGamingArenaBreakoutArenaBreakout10 from "@/assets/cards/gaming-arena-breakout-arena-breakout-10.jpg";
import cardGamingArenaBreakoutArenaBreakout100 from "@/assets/cards/gaming-arena-breakout-arena-breakout-100.jpg";
import cardGamingArenaBreakoutArenaBreakout25 from "@/assets/cards/gaming-arena-breakout-arena-breakout-25.jpg";
import cardGamingArenaBreakoutArenaBreakout5 from "@/assets/cards/gaming-arena-breakout-arena-breakout-5.jpg";
import cardGamingArenaBreakoutArenaBreakout50 from "@/assets/cards/gaming-arena-breakout-arena-breakout-50.jpg";
import cardGamingBattleOfKingsBattleOfKings89P99 from "@/assets/cards/gaming-battle-of-kings-battle-of-kings-89.99.jpg";
import cardGamingBlizzard20 from "@/assets/cards/gaming-blizzard-20.jpg";
import cardGamingBlizzard50 from "@/assets/cards/gaming-blizzard-50.jpg";
import cardGamingClimbingSandDuneClimbingSandDune19P79 from "@/assets/cards/gaming-climbing-sand-dune-climbing-sand-dune-19.79.jpg";
import cardGamingClimbingSandDuneClimbingSandDune8P99 from "@/assets/cards/gaming-climbing-sand-dune-climbing-sand-dune-8.99.jpg";
import cardGamingClimbingSandDuneClimbingSandDune89P99 from "@/assets/cards/gaming-climbing-sand-dune-climbing-sand-dune-89.99.jpg";
import cardGamingEaPlayEaPlay15UsaPcOnly from "@/assets/cards/gaming-ea-play-ea-play-15-usa-pc-only.jpg";
import cardGamingEaPlayEaPlay25UsaPcOnly from "@/assets/cards/gaming-ea-play-ea-play-25-usa-pc-only.jpg";
import cardGamingEveEveOnlinePlex1 from "@/assets/cards/gaming-eve-eve-online-plex-1.jpg";
import cardGamingEveEveOnlinePlex2 from "@/assets/cards/gaming-eve-eve-online-plex-2.jpg";
import cardGamingFreeFireDirect100Plus10Diamonds from "@/assets/cards/gaming-free-fire-direct-100-plus-10-diamonds.jpg";
import cardGamingFreeFireDirect1080Plus108Diamonds from "@/assets/cards/gaming-free-fire-direct-1080-plus-108-diamonds.jpg";
import cardGamingFreeFireDirect210Plus21Diamonds from "@/assets/cards/gaming-free-fire-direct-210-plus-21-diamonds.jpg";
import cardGamingFreeFireDirect2200Plus220Diamonds from "@/assets/cards/gaming-free-fire-direct-2200-plus-220-diamonds.jpg";
import cardGamingFreeFireDirect530Plus30Diamonds from "@/assets/cards/gaming-free-fire-direct-530-plus-30-diamonds.jpg";
import cardGamingGamestopGamestop10 from "@/assets/cards/gaming-gamestop-gamestop-10.jpg";
import cardGamingGamestopGamestop100 from "@/assets/cards/gaming-gamestop-gamestop-100.jpg";
import cardGamingGamestopGamestop25 from "@/assets/cards/gaming-gamestop-gamestop-25.jpg";
import cardGamingGamestopGamestop5 from "@/assets/cards/gaming-gamestop-gamestop-5.jpg";
import cardGamingGamestopGamestop50 from "@/assets/cards/gaming-gamestop-gamestop-50.jpg";
import cardGamingLegendsOfRuneterraLegendsOfRuneterra14 from "@/assets/cards/gaming-legends-of-runeterra-legends-of-runeterra-14.jpg";
import cardGamingLegendsOfRuneterraLegendsOfRuneterra28 from "@/assets/cards/gaming-legends-of-runeterra-legends-of-runeterra-28.jpg";
import cardGamingLudoClubCashLudoClub1Cash from "@/assets/cards/gaming-ludo-club-cash-ludo-club-1-cash.jpg";
import cardGamingLudoClubCashLudoClub100Cash from "@/assets/cards/gaming-ludo-club-cash-ludo-club-100-cash.jpg";
import cardGamingLudoClubCashLudoClub2Cash from "@/assets/cards/gaming-ludo-club-cash-ludo-club-2-cash.jpg";
import cardGamingLudoClubCashLudoClub20Cash from "@/assets/cards/gaming-ludo-club-cash-ludo-club-20-cash.jpg";
import cardGamingLudoClubCashLudoClub5Cash from "@/assets/cards/gaming-ludo-club-cash-ludo-club-5-cash.jpg";
import cardGamingLudoClubCashLudoClub60Cash from "@/assets/cards/gaming-ludo-club-cash-ludo-club-60-cash.jpg";
import cardGamingLudoClubCoinsLudoClub1Coins from "@/assets/cards/gaming-ludo-club-coins-ludo-club-1-coins.jpg";
import cardGamingLudoClubCoinsLudoClub10Coins from "@/assets/cards/gaming-ludo-club-coins-ludo-club-10-coins.jpg";
import cardGamingLudoClubCoinsLudoClub100Coins from "@/assets/cards/gaming-ludo-club-coins-ludo-club-100-coins.jpg";
import cardGamingLudoClubCoinsLudoClub15Coins from "@/assets/cards/gaming-ludo-club-coins-ludo-club-15-coins.jpg";
import cardGamingLudoClubCoinsLudoClub2Coins from "@/assets/cards/gaming-ludo-club-coins-ludo-club-2-coins.jpg";
import cardGamingLudoClubCoinsLudoClub30Coins from "@/assets/cards/gaming-ludo-club-coins-ludo-club-30-coins.jpg";
import cardGamingNexonNexon10 from "@/assets/cards/gaming-nexon-nexon-10.jpg";
import cardGamingNexonNexon100 from "@/assets/cards/gaming-nexon-nexon-100.jpg";
import cardGamingNexonNexon15Eu from "@/assets/cards/gaming-nexon-nexon-15-eu.jpg";
import cardGamingNexonNexon25 from "@/assets/cards/gaming-nexon-nexon-25.jpg";
import cardGamingNexonNexon50 from "@/assets/cards/gaming-nexon-nexon-50.jpg";
import cardGamingNintendo10 from "@/assets/cards/gaming-nintendo-10.jpg";
import cardGamingNintendo20 from "@/assets/cards/gaming-nintendo-20.jpg";
import cardGamingNintendo35 from "@/assets/cards/gaming-nintendo-35.jpg";
import cardGamingNintendo50 from "@/assets/cards/gaming-nintendo-50.jpg";
import cardGamingPlaystationKsaPsn10Ksa from "@/assets/cards/gaming-playstation-ksa-psn-10-ksa.jpg";
import cardGamingPlaystationKsaPsn20Ksa from "@/assets/cards/gaming-playstation-ksa-psn-20-ksa.jpg";
import cardGamingPlaystationKsaPsn40Ksa from "@/assets/cards/gaming-playstation-ksa-psn-40-ksa.jpg";
import cardGamingPlaystationKsaPsn50Ksa from "@/assets/cards/gaming-playstation-ksa-psn-50-ksa.jpg";
import cardGamingPlaystationKsaPsn60Ksa from "@/assets/cards/gaming-playstation-ksa-psn-60-ksa.jpg";
import cardGamingPlaystationLeb10Psn from "@/assets/cards/gaming-playstation-leb-10-psn.jpg";
import cardGamingPlaystationLeb100Psn from "@/assets/cards/gaming-playstation-leb-100-psn.jpg";
import cardGamingPlaystationLeb20Psn from "@/assets/cards/gaming-playstation-leb-20-psn.jpg";
import cardGamingPlaystationLeb40Psn from "@/assets/cards/gaming-playstation-leb-40-psn.jpg";
import cardGamingPlaystationLeb50Psn from "@/assets/cards/gaming-playstation-leb-50-psn.jpg";
import cardGamingPlaystationUae10Psn from "@/assets/cards/gaming-playstation-uae-10-psn.jpg";
import cardGamingPlaystationUae100Psn from "@/assets/cards/gaming-playstation-uae-100-psn.jpg";
import cardGamingPlaystationUae20Psn from "@/assets/cards/gaming-playstation-uae-20-psn.jpg";
import cardGamingPlaystationUae40Psn from "@/assets/cards/gaming-playstation-uae-40-psn.jpg";
import cardGamingPlaystationUae50Psn from "@/assets/cards/gaming-playstation-uae-50-psn.jpg";
import cardGamingPlaystationUae60Psn from "@/assets/cards/gaming-playstation-uae-60-psn.jpg";
import cardGamingPlaystationUae70Psn from "@/assets/cards/gaming-playstation-uae-70-psn.jpg";
import cardGamingPlaystationUsa10Psn from "@/assets/cards/gaming-playstation-usa-10-psn.jpg";
import cardGamingPlaystationUsa100Psn from "@/assets/cards/gaming-playstation-usa-100-psn.jpg";
import cardGamingPlaystationUsa25Psn from "@/assets/cards/gaming-playstation-usa-25-psn.jpg";
import cardGamingPlaystationUsa50Psn from "@/assets/cards/gaming-playstation-usa-50-psn.jpg";
import cardGamingPlaystationUsa75Psn from "@/assets/cards/gaming-playstation-usa-75-psn.jpg";
import cardGamingPubgDirect16200Uc from "@/assets/cards/gaming-pubg-direct-16200-uc.jpg";
import cardGamingPubgDirect1800Uc from "@/assets/cards/gaming-pubg-direct-1800-uc.jpg";
import cardGamingPubgDirect24300Uc from "@/assets/cards/gaming-pubg-direct-24300-uc.jpg";
import cardGamingPubgDirect32400Uc from "@/assets/cards/gaming-pubg-direct-32400-uc.jpg";
import cardGamingPubgDirect325Uc from "@/assets/cards/gaming-pubg-direct-325-uc.jpg";
import cardGamingPubgDirect3850Uc from "@/assets/cards/gaming-pubg-direct-3850-uc.jpg";
import cardGamingPubgDirect60 from "@/assets/cards/gaming-pubg-direct-60.jpg";
import cardGamingPubgDirect660Uc from "@/assets/cards/gaming-pubg-direct-660-uc.jpg";
import cardGamingPubgDirect8100Uc from "@/assets/cards/gaming-pubg-direct-8100-uc.jpg";
import cardGamingPubgNewStatePubgNewState51 from "@/assets/cards/gaming-pubg-new-state-pubg-new-state-51.jpg";
import cardGamingRazerGold1 from "@/assets/cards/gaming-razer-gold-1.jpg";
import cardGamingRazerGold10 from "@/assets/cards/gaming-razer-gold-10.jpg";
import cardGamingRazerGold100 from "@/assets/cards/gaming-razer-gold-100.jpg";
import cardGamingRazerGold2 from "@/assets/cards/gaming-razer-gold-2.jpg";
import cardGamingRazerGold20 from "@/assets/cards/gaming-razer-gold-20.jpg";
import cardGamingRazerGold200 from "@/assets/cards/gaming-razer-gold-200.jpg";
import cardGamingRazerGold5 from "@/assets/cards/gaming-razer-gold-5.jpg";
import cardGamingRazerGold50 from "@/assets/cards/gaming-razer-gold-50.jpg";
import cardGamingRiotUsaRiotAccessUsa10 from "@/assets/cards/gaming-riot-usa-riot-access-usa-10.jpg";
import cardGamingRiotUsaRiotAccessUsa100 from "@/assets/cards/gaming-riot-usa-riot-access-usa-100.jpg";
import cardGamingRiotUsaRiotAccessUsa20 from "@/assets/cards/gaming-riot-usa-riot-access-usa-20.jpg";
import cardGamingRiotUsaRiotAccessUsa25 from "@/assets/cards/gaming-riot-usa-riot-access-usa-25.jpg";
import cardGamingRiotUsaRiotAccessUsa35 from "@/assets/cards/gaming-riot-usa-riot-access-usa-35.jpg";
import cardGamingRiotUsaRiotAccessUsa50 from "@/assets/cards/gaming-riot-usa-riot-access-usa-50.jpg";
import cardGamingRoblox10 from "@/assets/cards/gaming-roblox-10.jpg";
import cardGamingRoblox100 from "@/assets/cards/gaming-roblox-100.jpg";
import cardGamingRoblox25 from "@/assets/cards/gaming-roblox-25.jpg";
import cardGamingRoblox50 from "@/assets/cards/gaming-roblox-50.jpg";
import cardGamingRobloxKsaRoblox100SarKsa from "@/assets/cards/gaming-roblox-ksa-roblox-100-sar-ksa.jpg";
import cardGamingRobloxKsaRoblox20SarKsa from "@/assets/cards/gaming-roblox-ksa-roblox-20-sar-ksa.jpg";
import cardGamingRobloxKsaRoblox200SarKsa from "@/assets/cards/gaming-roblox-ksa-roblox-200-sar-ksa.jpg";
import cardGamingRobloxKsaRoblox500SarKsa from "@/assets/cards/gaming-roblox-ksa-roblox-500-sar-ksa.jpg";
import cardGamingRobloxUaeRoblox100AedUae from "@/assets/cards/gaming-roblox-uae-roblox-100-aed-uae.jpg";
import cardGamingRobloxUaeRoblox20AedUae from "@/assets/cards/gaming-roblox-uae-roblox-20-aed-uae.jpg";
import cardGamingRobloxUaeRoblox200AedUae from "@/assets/cards/gaming-roblox-uae-roblox-200-aed-uae.jpg";
import cardGamingRobloxUaeRoblox500AedUae from "@/assets/cards/gaming-roblox-uae-roblox-500-aed-uae.jpg";
import cardGamingRunescapeRunescape10 from "@/assets/cards/gaming-runescape-runescape-10.jpg";
import cardGamingRunescapeRunescape25 from "@/assets/cards/gaming-runescape-runescape-25.jpg";
import cardGamingSteam10 from "@/assets/cards/gaming-steam-10.jpg";
import cardGamingSteam20 from "@/assets/cards/gaming-steam-20.jpg";
import cardGamingSteam50 from "@/assets/cards/gaming-steam-50.jpg";
import cardGamingSteamUaeSteamAed200 from "@/assets/cards/gaming-steam-uae-steam-aed-200.jpg";
import cardGamingSteamUaeSteamAed400 from "@/assets/cards/gaming-steam-uae-steam-aed-400.jpg";
import cardGamingSteamUaeSteamAed50 from "@/assets/cards/gaming-steam-uae-steam-aed-50.jpg";
import cardGamingSteamUsaSteam100 from "@/assets/cards/gaming-steam-usa-steam-100.jpg";
import cardGamingUndawnUndawn1 from "@/assets/cards/gaming-undawn-undawn-1.jpg";
import cardGamingUndawnUndawn10 from "@/assets/cards/gaming-undawn-undawn-10.jpg";
import cardGamingUndawnUndawn3 from "@/assets/cards/gaming-undawn-undawn-3.jpg";
import cardGamingUndawnUndawn5 from "@/assets/cards/gaming-undawn-undawn-5.jpg";
import cardGamingXbox10 from "@/assets/cards/gaming-xbox-10.jpg";
import cardGamingXbox100 from "@/assets/cards/gaming-xbox-100.jpg";
import cardGamingXbox15 from "@/assets/cards/gaming-xbox-15.jpg";
import cardGamingXbox20 from "@/assets/cards/gaming-xbox-20.jpg";
import cardGamingXbox25 from "@/assets/cards/gaming-xbox-25.jpg";
import cardGamingXbox5 from "@/assets/cards/gaming-xbox-5.jpg";
import cardGamingXbox50 from "@/assets/cards/gaming-xbox-50.jpg";
import cardGamingXboxKsaXbox100SarKsa from "@/assets/cards/gaming-xbox-ksa-xbox-100-sar-ksa.jpg";
import cardGamingXboxKsaXbox200SarKsa from "@/assets/cards/gaming-xbox-ksa-xbox-200-sar-ksa.jpg";
import cardGamingXboxKsaXbox300SarKsa from "@/assets/cards/gaming-xbox-ksa-xbox-300-sar-ksa.jpg";
import cardGamingXboxKsaXbox50SarKsa from "@/assets/cards/gaming-xbox-ksa-xbox-50-sar-ksa.jpg";
import cardGiftCardsDiscordDiscord10 from "@/assets/cards/gift-cards-discord-discord-10.jpg";
import cardGiftCardsDiscordDiscord100 from "@/assets/cards/gift-cards-discord-discord-100.jpg";
import cardGiftCardsDiscordDiscordClassicBasic5 from "@/assets/cards/gift-cards-discord-discord-classic-basic-5.jpg";
import cardGiftCardsEbayEbay100NotRedeemableOutsideUsa from "@/assets/cards/gift-cards-ebay-ebay-100-not-redeemable-outside-usa.jpg";
import cardGiftCardsEbayEbay50NotRedeemableOutsideUsa from "@/assets/cards/gift-cards-ebay-ebay-50-not-redeemable-outside-usa.jpg";
import cardGiftCardsItunesKsaItunesSar150Ksa from "@/assets/cards/gift-cards-itunes-ksa-itunes-sar-150-ksa.jpg";
import cardGiftCardsItunesKsaItunesSar200Ksa from "@/assets/cards/gift-cards-itunes-ksa-itunes-sar-200-ksa.jpg";
import cardGiftCardsItunesKsaItunesSar250Ksa from "@/assets/cards/gift-cards-itunes-ksa-itunes-sar-250-ksa.jpg";
import cardGiftCardsItunesKsaItunesSar50Ksa from "@/assets/cards/gift-cards-itunes-ksa-itunes-sar-50-ksa.jpg";
import cardGiftCardsItunesKsaItunesSar500Ksa from "@/assets/cards/gift-cards-itunes-ksa-itunes-sar-500-ksa.jpg";
import cardGiftCardsItunesKsaItunesSar75Ksa from "@/assets/cards/gift-cards-itunes-ksa-itunes-sar-75-ksa.jpg";
import cardGiftCardsItunesUaeItunesAed100Uae from "@/assets/cards/gift-cards-itunes-uae-itunes-aed-100-uae.jpg";
import cardGiftCardsItunesUaeItunesAed250Uae from "@/assets/cards/gift-cards-itunes-uae-itunes-aed-250-uae.jpg";
import cardGiftCardsItunesUaeItunesAed50Uae from "@/assets/cards/gift-cards-itunes-uae-itunes-aed-50-uae.jpg";
import cardGiftCardsItunesUaeItunesAed500Uae from "@/assets/cards/gift-cards-itunes-uae-itunes-aed-500-uae.jpg";
import cardGiftCardsItunesUsaItunes10Usa from "@/assets/cards/gift-cards-itunes-usa-itunes-10-usa.jpg";
import cardGiftCardsItunesUsaItunes100Usa from "@/assets/cards/gift-cards-itunes-usa-itunes-100-usa.jpg";
import cardGiftCardsItunesUsaItunes15Usa from "@/assets/cards/gift-cards-itunes-usa-itunes-15-usa.jpg";
import cardGiftCardsItunesUsaItunes20Usa from "@/assets/cards/gift-cards-itunes-usa-itunes-20-usa.jpg";
import cardGiftCardsItunesUsaItunes25Usa from "@/assets/cards/gift-cards-itunes-usa-itunes-25-usa.jpg";
import cardGiftCardsItunesUsaItunes400Usa from "@/assets/cards/gift-cards-itunes-usa-itunes-400-usa.jpg";
import cardGiftCardsItunesUsaItunes5Usa from "@/assets/cards/gift-cards-itunes-usa-itunes-5-usa.jpg";
import cardGiftCardsItunesUsaItunes50Usa from "@/assets/cards/gift-cards-itunes-usa-itunes-50-usa.jpg";
import cardGiftCardsNortonNorton360Deluxe25Gb12M from "@/assets/cards/gift-cards-norton-norton-360-deluxe-25gb-12m.jpg";
import cardGiftCardsNortonNorton360Premium75Gb12M from "@/assets/cards/gift-cards-norton-norton-360-premium-75gb-12m.jpg";
import cardGiftCardsSheinSheinEGiftCard100 from "@/assets/cards/gift-cards-shein-shein-e-gift-card-100.jpg";
import cardGiftCardsSheinSheinEGiftCard300 from "@/assets/cards/gift-cards-shein-shein-e-gift-card-300.jpg";
import cardGiftCardsSheinSheinEGiftCard500 from "@/assets/cards/gift-cards-shein-shein-e-gift-card-500.jpg";
import cardGiftCardsSheinSheinEGiftCard800 from "@/assets/cards/gift-cards-shein-shein-e-gift-card-800.jpg";
import cardGiftCardsYallaLiveYallaLive100 from "@/assets/cards/gift-cards-yalla-live-yalla-live-100.jpg";
import cardGiftCardsYallaLiveYallaLive25 from "@/assets/cards/gift-cards-yalla-live-yalla-live-25.jpg";
import cardGiftCardsYallaLiveYallaLive300 from "@/assets/cards/gift-cards-yalla-live-yalla-live-300.jpg";
import cardGiftCardsYallaLiveYallaLive50 from "@/assets/cards/gift-cards-yalla-live-yalla-live-50.jpg";
import cardGiftCardsYallaLiveYallaLive500 from "@/assets/cards/gift-cards-yalla-live-yalla-live-500.jpg";
import cardInternetConnectConnectDsl4M85Gb from "@/assets/cards/internet-connect-connect-dsl-4m-85-gb.jpg";
import cardInternetConnectConnectDsl4Mb85GbFnt from "@/assets/cards/internet-connect-connect-dsl-4mb-85gb-fnt.jpg";
import cardInternetConnectConnectDsl6MUnlimited from "@/assets/cards/internet-connect-connect-dsl-6m-unlimited.jpg";
import cardInternetConnectConnectDsl8MUnlimited from "@/assets/cards/internet-connect-connect-dsl-8m-unlimited.jpg";
import cardInternetConnectConnectDslFreeze from "@/assets/cards/internet-connect-connect-dsl-freeze.jpg";
import cardInternetConnectConnectDslOpenSpeed160Gb from "@/assets/cards/internet-connect-connect-dsl-open-speed-160-gb.jpg";
import cardInternetConnectConnectDslOpenSpeed320Gb from "@/assets/cards/internet-connect-connect-dsl-open-speed-320-gb.jpg";
import cardInternetConnectConnectDslOpenSpeed500Gb from "@/assets/cards/internet-connect-connect-dsl-open-speed-500-gb.jpg";
import cardInternetConnectConnectDslOs160GbPlusFnt from "@/assets/cards/internet-connect-connect-dsl-os-160gb-plus-fnt.jpg";
import cardInternetConnectConnectDslOs320GbPlusFnt from "@/assets/cards/internet-connect-connect-dsl-os-320gb-plus-fnt.jpg";
import cardInternetConnectConnectDslOs500GbPlusFnt from "@/assets/cards/internet-connect-connect-dsl-os-500gb-plus-fnt.jpg";
import cardInternetConnectConnectFiber1100Gb from "@/assets/cards/internet-connect-connect-fiber-1100-gb.jpg";
import cardInternetConnectConnectFiber1100GbPlusFnt from "@/assets/cards/internet-connect-connect-fiber-1100gb-plus-fnt.jpg";
import cardInternetConnectConnectFiber330Gb from "@/assets/cards/internet-connect-connect-fiber-330-gb.jpg";
import cardInternetConnectConnectFiber330GbPlusFnt from "@/assets/cards/internet-connect-connect-fiber-330gb-plus-fnt.jpg";
import cardInternetConnectConnectFiber550Gb from "@/assets/cards/internet-connect-connect-fiber-550-gb.jpg";
import cardInternetConnectConnectFiber550GbPlusFnt from "@/assets/cards/internet-connect-connect-fiber-550gb-plus-fnt.jpg";
import cardInternetConnectConnectFiber825Gb from "@/assets/cards/internet-connect-connect-fiber-825-gb.jpg";
import cardInternetConnectConnectFiber825GbPlusFnt from "@/assets/cards/internet-connect-connect-fiber-825gb-plus-fnt.jpg";
import cardInternetConnectConnectFiberFreeze from "@/assets/cards/internet-connect-connect-fiber-freeze.jpg";
import cardInternetConnectConnectFwaBasic10Mbps100Gb from "@/assets/cards/internet-connect-connect-fwa-basic-10mbps-100gb.jpg";
import cardInternetConnectConnectFwaFreeze from "@/assets/cards/internet-connect-connect-fwa-freeze.jpg";
import cardInternetConnectConnectFwaGold10Mbps300Gb from "@/assets/cards/internet-connect-connect-fwa-gold-10mbps-300gb.jpg";
import cardInternetConnectConnectFwaPlatinum10Mbps450Gb from "@/assets/cards/internet-connect-connect-fwa-platinum-10-mbps-450gb.jpg";
import cardInternetConnectConnectFwaSilver10Mbps145Gb from "@/assets/cards/internet-connect-connect-fwa-silver-10mbps-145gb.jpg";
import cardInternetConnectConnectFwaSmartUnlimited5Gb from "@/assets/cards/internet-connect-connect-fwa-smart-unlimited-5gb.jpg";
import cardInternetConnectConnectFwaSmartUnlimited8Gb from "@/assets/cards/internet-connect-connect-fwa-smart-unlimited-8gb.jpg";
import cardInternetMobi4Mb80GbFnq from "@/assets/cards/internet-mobi-4mb-80gb-fnq.jpg";
import cardInternetMobi4Mb80Gb from "@/assets/cards/internet-mobi-4mb-80gb.jpg";
import cardInternetMobi4MbUnl from "@/assets/cards/internet-mobi-4mb-unl.jpg";
import cardInternetMobi6MbUnl from "@/assets/cards/internet-mobi-6mb-unl.jpg";
import cardInternetMobi8MbUnl from "@/assets/cards/internet-mobi-8mb-unl.jpg";
import cardInternetMobiMobiDslOpenPlayUnlimited from "@/assets/cards/internet-mobi-mobi-dsl-open-play-unlimited.jpg";
import cardInternetMobiMobiDslOs115GbFnq from "@/assets/cards/internet-mobi-mobi-dsl-os-115-gb-fnq.jpg";
import cardInternetMobiMobiDslOs175GbFnq from "@/assets/cards/internet-mobi-mobi-dsl-os-175-gb-fnq.jpg";
import cardInternetMobiMobiDslOs220GbFnq from "@/assets/cards/internet-mobi-mobi-dsl-os-220-gb-fnq.jpg";
import cardInternetMobiMobiDslOs330GbFnq from "@/assets/cards/internet-mobi-mobi-dsl-os-330-gb-fnq.jpg";
import cardInternetMobiMobiDslOs440GbFnq from "@/assets/cards/internet-mobi-mobi-dsl-os-440-gb-fnq.jpg";
import cardInternetMobiMobiDslOs550GbFnq from "@/assets/cards/internet-mobi-mobi-dsl-os-550-gb-fnq.jpg";
import cardInternetMobiMobiFiber1000GbFnq from "@/assets/cards/internet-mobi-mobi-fiber-1000-gb-fnq.jpg";
import cardInternetMobiMobiFiber1500GbFnq from "@/assets/cards/internet-mobi-mobi-fiber-1500-gb-fnq.jpg";
import cardInternetMobiMobiFiber2000GbFnq from "@/assets/cards/internet-mobi-mobi-fiber-2000-gb-fnq.jpg";
import cardInternetMobiMobiFiber2500GbFnq from "@/assets/cards/internet-mobi-mobi-fiber-2500-gb-fnq.jpg";
import cardInternetMobiMobiFiber300Gb from "@/assets/cards/internet-mobi-mobi-fiber-300-gb.jpg";
import cardInternetMobiMobiFiber400GbFnq from "@/assets/cards/internet-mobi-mobi-fiber-400-gb-fnq.jpg";
import cardInternetMobiMobiFiber500GbFnq from "@/assets/cards/internet-mobi-mobi-fiber-500-gb-fnq.jpg";
import cardInternetMobiMobiFiber600GbFnq from "@/assets/cards/internet-mobi-mobi-fiber-600-gb-fnq.jpg";
import cardInternetMobiMobiFiber800GbFnq from "@/assets/cards/internet-mobi-mobi-fiber-800-gb-fnq.jpg";
import cardInternetMobiMobiFiberLite150Gb from "@/assets/cards/internet-mobi-mobi-fiber-lite-150-gb.jpg";
import cardInternetMobiMobiFiberUnlimited from "@/assets/cards/internet-mobi-mobi-fiber-unlimited.jpg";
import cardInternetMobiOs100GbFnq from "@/assets/cards/internet-mobi-os-100gb-fnq.jpg";
import cardInternetMobiOs80GbFnq from "@/assets/cards/internet-mobi-os-80gb-fnq.jpg";
import cardInternetMobiOs80Gb from "@/assets/cards/internet-mobi-os-80gb.jpg";
import cardInternetTerranet4Mb100Gb from "@/assets/cards/internet-terranet-4mb-100gb.jpg";
import cardInternetTerranet4MbUnlOs160Gb from "@/assets/cards/internet-terranet-4mb-unl-os-160gb.jpg";
import cardInternetTerranet6MbUnlOs200Gb from "@/assets/cards/internet-terranet-6mb-unl-os-200gb.jpg";
import cardInternetTerranet8MbUnlPlay from "@/assets/cards/internet-terranet-8mb-unl-play.jpg";
import cardInternetTerranetArmyDsl4Mb100Gb from "@/assets/cards/internet-terranet-army-dsl-4mb-100gb.jpg";
import cardInternetTerranetArmyDsl8MbUnlPlay from "@/assets/cards/internet-terranet-army-dsl-8mb-unl-play.jpg";
import cardInternetTerranetArmyDslOs120Gb from "@/assets/cards/internet-terranet-army-dsl-os-120gb.jpg";
import cardInternetTerranetArmyDslOs160Gb4MbUnl from "@/assets/cards/internet-terranet-army-dsl-os-160gb-4mb-unl.jpg";
import cardInternetTerranetArmyDslOs200Gb6MbUnl from "@/assets/cards/internet-terranet-army-dsl-os-200gb-6mb-unl.jpg";
import cardInternetTerranetArmyDslOs240Gb from "@/assets/cards/internet-terranet-army-dsl-os-240gb.jpg";
import cardInternetTerranetArmyDslOs400Gb from "@/assets/cards/internet-terranet-army-dsl-os-400gb.jpg";
import cardInternetTerranetArmyDslOs500Gb from "@/assets/cards/internet-terranet-army-dsl-os-500gb.jpg";
import cardInternetTerranetDslExtraVolume5Gb from "@/assets/cards/internet-terranet-dsl-extra-volume-5gb.jpg";
import cardInternetTerranetFiber300Mb1000Gb from "@/assets/cards/internet-terranet-fiber-300mb-1000gb.jpg";
import cardInternetTerranetFiber300Mb1500Gb from "@/assets/cards/internet-terranet-fiber-300mb-1500gb.jpg";
import cardInternetTerranetFiber300Mb2000Gb from "@/assets/cards/internet-terranet-fiber-300mb-2000gb.jpg";
import cardInternetTerranetFiber300Mb2500Gb from "@/assets/cards/internet-terranet-fiber-300mb-2500gb.jpg";
import cardInternetTerranetFiber300Mb300Gb from "@/assets/cards/internet-terranet-fiber-300mb-300gb.jpg";
import cardInternetTerranetFiber300Mb400Gb from "@/assets/cards/internet-terranet-fiber-300mb-400gb.jpg";
import cardInternetTerranetFiber300Mb500Gb from "@/assets/cards/internet-terranet-fiber-300mb-500gb.jpg";
import cardInternetTerranetFiber300Mb850Gb from "@/assets/cards/internet-terranet-fiber-300mb-850gb.jpg";
import cardInternetTerranetFiber50MbUnl from "@/assets/cards/internet-terranet-fiber-50mb-unl.jpg";
import cardInternetTerranetOpenSpeed1000Gb from "@/assets/cards/internet-terranet-open-speed-1000gb.jpg";
import cardInternetTerranetOpenSpeed120Gb from "@/assets/cards/internet-terranet-open-speed-120gb.jpg";
import cardInternetTerranetOpenSpeed240Gb from "@/assets/cards/internet-terranet-open-speed-240gb.jpg";
import cardInternetTerranetOpenSpeed400Gb from "@/assets/cards/internet-terranet-open-speed-400gb.jpg";
import cardInternetTerranetOpenSpeed500Gb from "@/assets/cards/internet-terranet-open-speed-500gb.jpg";
import cardInternetTerranetTerrArmyDsl4Mb60Gb from "@/assets/cards/internet-terranet-terr-army-dsl-4mb-60gb.jpg";
import cardInternetTerranetTerrDsl4Mb60Gb from "@/assets/cards/internet-terranet-terr-dsl-4mb-60gb.jpg";
import cardInternetWise11100 from "@/assets/cards/internet-wise-11100.jpg";
import cardInternetWise2890 from "@/assets/cards/internet-wise-2890.jpg";
import cardInternetWise5780 from "@/assets/cards/internet-wise-5780.jpg";
import cardInternetWise8000 from "@/assets/cards/internet-wise-8000.jpg";
import cardMtc1P67 from "@/assets/cards/mtc-1.67.jpg";
import cardMtc15P15 from "@/assets/cards/mtc-15.15.jpg";
import cardMtc22P73 from "@/assets/cards/mtc-22.73.jpg";
import cardMtc3P79 from "@/assets/cards/mtc-3.79.jpg";
import cardMtc4P5 from "@/assets/cards/mtc-4.5.jpg";
import cardMtc7P58 from "@/assets/cards/mtc-7.58.jpg";
import cardMtc77P28 from "@/assets/cards/mtc-77.28.jpg";
import cardMtcPrepaid10 from "@/assets/cards/mtc-prepaid-10.jpg";
import cardMtcPrepaidSmart from "@/assets/cards/mtc-prepaid-smart.jpg";
import cardMtcPrepaidStartsos from "@/assets/cards/mtc-prepaid-startsos.jpg";
import cardMtcPrepaidSuper from "@/assets/cards/mtc-prepaid-super.jpg";
import cardMtcStart from "@/assets/cards/mtc-start.jpg";
import cardMtcValidity180Days from "@/assets/cards/mtc-validity-180-days.jpg";
import cardMtcValidity30Days from "@/assets/cards/mtc-validity-30-days.jpg";
import cardMtcValidity360Days from "@/assets/cards/mtc-validity-360-days.jpg";
import cardMtcValidity60Days from "@/assets/cards/mtc-validity-60-days.jpg";
import cardMtcValidity90Days from "@/assets/cards/mtc-validity-90-days.jpg";
import cardStreamingAnghamiAnghamiFamily12M from "@/assets/cards/streaming-anghami-anghami-family-12m.jpg";
import cardStreamingAnghamiAnghamiFamily1M from "@/assets/cards/streaming-anghami-anghami-family-1m.jpg";
import cardStreamingAnghamiAnghamiGold12M from "@/assets/cards/streaming-anghami-anghami-gold-12m.jpg";
import cardStreamingAnghamiAnghamiGold1M from "@/assets/cards/streaming-anghami-anghami-gold-1m.jpg";
import cardStreamingAnghamiAnghamiPlus12M from "@/assets/cards/streaming-anghami-anghami-plus-12m.jpg";
import cardStreamingAnghamiAnghamiPlus1M from "@/assets/cards/streaming-anghami-anghami-plus-1m.jpg";
import cardStreamingAnghamiAnghamiPlus3M from "@/assets/cards/streaming-anghami-anghami-plus-3m.jpg";
import cardStreamingAnghamiAnghamiPlus6M from "@/assets/cards/streaming-anghami-anghami-plus-6m.jpg";
import cardStreamingMbcShahidShahidVip12MLebanon from "@/assets/cards/streaming-mbc-shahid-shahid-vip-12m-lebanon.jpg";
import cardStreamingMbcShahidShahidVip3MLebanon from "@/assets/cards/streaming-mbc-shahid-shahid-vip-3m-lebanon.jpg";
import cardStreamingMbcShahidUaeShahidVip12MUae from "@/assets/cards/streaming-mbc-shahid-uae-shahid-vip-12m-uae.jpg";
import cardStreamingMbcShahidUaeShahidVip3MUae from "@/assets/cards/streaming-mbc-shahid-uae-shahid-vip-3m-uae.jpg";
import cardStreamingNetflixUaeNetflix100AedUaeOnly from "@/assets/cards/streaming-netflix-uae-netflix-100-aed-uae-only.jpg";
import cardStreamingNetflixUaeNetflix500AedUaeOnly from "@/assets/cards/streaming-netflix-uae-netflix-500-aed-uae-only.jpg";
import cardStreamingNetflixUsaNetflix15 from "@/assets/cards/streaming-netflix-usa-netflix-15.jpg";
import cardStreamingNetflixUsaNetflix20 from "@/assets/cards/streaming-netflix-usa-netflix-20.jpg";
import cardStreamingNetflixUsaNetflix25 from "@/assets/cards/streaming-netflix-usa-netflix-25.jpg";
import cardStreamingNetflixUsaNetflix30 from "@/assets/cards/streaming-netflix-usa-netflix-30.jpg";
import cardStreamingNetflixUsaNetflix50 from "@/assets/cards/streaming-netflix-usa-netflix-50.jpg";
import cardStreamingOsnPlusLebanonOsnPlusPremium12MLebanon from "@/assets/cards/streaming-osn-plus-lebanon-osn-plus-premium-12m-lebanon.jpg";
import cardStreamingOsnPlusLebanonOsnPlusPremium1MLebanon from "@/assets/cards/streaming-osn-plus-lebanon-osn-plus-premium-1m-lebanon.jpg";
import cardStreamingOsnPlusLebanonOsnPlusPremium3MLebanon from "@/assets/cards/streaming-osn-plus-lebanon-osn-plus-premium-3m-lebanon.jpg";
import cardStreamingOsnPlusLebanonOsnPlusPremium6MLebanon from "@/assets/cards/streaming-osn-plus-lebanon-osn-plus-premium-6m-lebanon.jpg";
import cardStreamingOsnPlusLebanonOsnPlusStandard12MLebanon from "@/assets/cards/streaming-osn-plus-lebanon-osn-plus-standard-12m-lebanon.jpg";
import cardStreamingOsnPlusLebanonOsnPlusStandard1MLebanon from "@/assets/cards/streaming-osn-plus-lebanon-osn-plus-standard-1m-lebanon.jpg";
import cardStreamingOsnPlusLebanonOsnPlusStandard3MLebanon from "@/assets/cards/streaming-osn-plus-lebanon-osn-plus-standard-3m-lebanon.jpg";
import cardStreamingOsnPlusLebanonOsnPlusStandard6MLebanon from "@/assets/cards/streaming-osn-plus-lebanon-osn-plus-standard-6m-lebanon.jpg";
import cardStreamingPoduPodu10P35 from "@/assets/cards/streaming-podu-podu-10.35.jpg";
import cardStreamingPoduPodu5P14 from "@/assets/cards/streaming-podu-podu-5.14.jpg";
import cardStreamingStarzplayStarzplay12M from "@/assets/cards/streaming-starzplay-starzplay-12m.jpg";
import cardStreamingStarzplayStarzplay3M from "@/assets/cards/streaming-starzplay-starzplay-3m.jpg";
import cardStreamingStarzplayStarzplay6M from "@/assets/cards/streaming-starzplay-starzplay-6m.jpg";
import cardStreamingStarzplayUaeStarzplay100Aed3MUae from "@/assets/cards/streaming-starzplay-uae-starzplay-100-aed-3m-uae.jpg";
import cardStreamingStarzplayUaeStarzplay195Aed6MUae from "@/assets/cards/streaming-starzplay-uae-starzplay-195-aed-6m-uae.jpg";
import cardStreamingStarzplayUaeStarzplay330Aed12MUae from "@/assets/cards/streaming-starzplay-uae-starzplay-330-aed-12m-uae.jpg";
import cardStreamingStarzplayUaeStarzplay40Aed1MUae from "@/assets/cards/streaming-starzplay-uae-starzplay-40-aed-1m-uae.jpg";
import cardStreamingTwitchTwitch100NotRedeemableOutsideUsa from "@/assets/cards/streaming-twitch-twitch-100-not-redeemable-outside-usa.jpg";
import cardStreamingTwitchTwitch50NotRedeemableOutsideUsa from "@/assets/cards/streaming-twitch-twitch-50-not-redeemable-outside-usa.jpg";
import cardTelecomDuUaeDuPin110Aed from "@/assets/cards/telecom-du-uae-du-pin-110-aed.jpg";
import cardTelecomDuUaeDuPin210Aed from "@/assets/cards/telecom-du-uae-du-pin-210-aed.jpg";
import cardTelecomDuUaeDuPin25Aed from "@/assets/cards/telecom-du-uae-du-pin-25-aed.jpg";
import cardTelecomDuUaeDuPin525Aed from "@/assets/cards/telecom-du-uae-du-pin-525-aed.jpg";
import cardTelecomDuUaeDuPin55Aed from "@/assets/cards/telecom-du-uae-du-pin-55-aed.jpg";
import cardTelecomEtisalatUaeEtisalatPin110Aed from "@/assets/cards/telecom-etisalat-uae-etisalat-pin-110-aed.jpg";
import cardTelecomEtisalatUaeEtisalatPin210Aed from "@/assets/cards/telecom-etisalat-uae-etisalat-pin-210-aed.jpg";
import cardTelecomEtisalatUaeEtisalatPin30Aed from "@/assets/cards/telecom-etisalat-uae-etisalat-pin-30-aed.jpg";
import cardTelecomEtisalatUaeEtisalatPin525Aed from "@/assets/cards/telecom-etisalat-uae-etisalat-pin-525-aed.jpg";
import cardTelecomEtisalatUaeEtisalatPin55Aed from "@/assets/cards/telecom-etisalat-uae-etisalat-pin-55-aed.jpg";
import cardTelecomStcKsaStcSar100 from "@/assets/cards/telecom-stc-ksa-stc-sar-100.jpg";
import cardTelecomStcKsaStcSar17P39 from "@/assets/cards/telecom-stc-ksa-stc-sar-17.39.jpg";
import cardTelecomStcKsaStcSar20 from "@/assets/cards/telecom-stc-ksa-stc-sar-20.jpg";
import cardTelecomStcKsaStcSar200 from "@/assets/cards/telecom-stc-ksa-stc-sar-200.jpg";
import cardTelecomStcKsaStcSar30 from "@/assets/cards/telecom-stc-ksa-stc-sar-30.jpg";
import cardTelecomStcKsaStcSar300 from "@/assets/cards/telecom-stc-ksa-stc-sar-300.jpg";
import cardTelecomStcKsaStcSar50 from "@/assets/cards/telecom-stc-ksa-stc-sar-50.jpg";
import cardTransportationActcActc100 from "@/assets/cards/transportation-actc-actc-100.jpg";
import cardTransportationActcActc130 from "@/assets/cards/transportation-actc-actc-130.jpg";
import cardTransportationActcActc150 from "@/assets/cards/transportation-actc-actc-150.jpg";
import cardTransportationActcActc200 from "@/assets/cards/transportation-actc-actc-200.jpg";
import cardTransportationActcActc80 from "@/assets/cards/transportation-actc-actc-80.jpg";

export const CARD_IMAGE_MANIFEST: Readonly<Record<string, string>> = {
  "alfa|alfa go|alfa go": cardAlfaAlfaGoAlfaGo,
  "alfa|alfa go|alfa go max": cardAlfaAlfaGoAlfaGoMax,
  "alfa|alfa go|alfa go+": cardAlfaAlfaGoAlfaGoPlus,
  "alfa|boosters|20mins": cardAlfaBoosters20Mins,
  "alfa|boosters|50mb": cardAlfaBoosters50Mb,
  "alfa|boosters|600mb": cardAlfaBoosters600Mb,
  "alfa|boosters|unlinmited 2hrs": cardAlfaBoostersUnlinmited2Hrs,
  "alfa|mobile broadband|111gb": cardAlfaMobileBroadband111Gb,
  "alfa|mobile broadband|1gb": cardAlfaMobileBroadband1Gb,
  "alfa|mobile broadband|22gb": cardAlfaMobileBroadband22Gb,
  "alfa|mobile broadband|444gb": cardAlfaMobileBroadband444Gb,
  "alfa|mobile broadband|44gb": cardAlfaMobileBroadband44Gb,
  "alfa|mobile broadband|77gb": cardAlfaMobileBroadband77Gb,
  "alfa|mobile broadband|7gb": cardAlfaMobileBroadband7Gb,
  "alfa|mobile internet|111gb": cardAlfaMobileInternet111Gb,
  "alfa|mobile internet|1gb": cardAlfaMobileInternet1Gb,
  "alfa|mobile internet|22gb": cardAlfaMobileInternet22Gb,
  "alfa|mobile internet|444gb": cardAlfaMobileInternet444Gb,
  "alfa|mobile internet|44gb": cardAlfaMobileInternet44Gb,
  "alfa|mobile internet|77gb": cardAlfaMobileInternet77Gb,
  "alfa|mobile internet|7gb": cardAlfaMobileInternet7Gb,
  "alfa|mobile internet (postpaid)|120gb": cardAlfaMobileInternetPostpaid120Gb,
  "alfa|mobile internet (postpaid)|1gb": cardAlfaMobileInternetPostpaid1Gb,
  "alfa|mobile internet (postpaid)|25gb": cardAlfaMobileInternetPostpaid25Gb,
  "alfa|mobile internet (postpaid)|475gb": cardAlfaMobileInternetPostpaid475Gb,
  "alfa|mobile internet (postpaid)|50gb": cardAlfaMobileInternetPostpaid50Gb,
  "alfa|mobile internet (postpaid)|7gb": cardAlfaMobileInternetPostpaid7Gb,
  "alfa|mobile internet (postpaid)|85gb": cardAlfaMobileInternetPostpaid85Gb,
  "alfa|prepaid|1.22": cardAlfaPrepaid1P22,
  "alfa|prepaid|10": cardAlfaPrepaid10,
  "alfa|prepaid|15.15": cardAlfa15P15,
  "alfa|prepaid|22.73": cardAlfa22P73,
  "alfa|prepaid|3.03": cardAlfa3P03,
  "alfa|prepaid|4.5": cardAlfaPrepaid4P5,
  "alfa|prepaid|7.58": cardAlfa7P58,
  "alfa|prepaid|77.28": cardAlfa77P28,
  "alfa|surf & talk|4x4": cardAlfaSurfAndTalk4X4,
  "alfa|surf & talk|5x5": cardAlfaSurfAndTalk5X5,
  "alfa|weekender|the weekender": cardAlfaWeekenderTheWeekender,
  "alfa|weekly data|1.5gb": cardAlfaWeeklyData1P5Gb,
  "alfa|weekly data|500mb": cardAlfaWeeklyData500Mb,
  "alfa|weekly data|5gb": cardAlfaWeeklyData5Gb,
  "gaming|apex|apex 20 - usa (pc only)": cardGamingApexApex20UsaPcOnly,
  "gaming|arena breakout|arena breakout 1":
    cardGamingArenaBreakoutArenaBreakout1,
  "gaming|arena breakout|arena breakout 10":
    cardGamingArenaBreakoutArenaBreakout10,
  "gaming|arena breakout|arena breakout 100":
    cardGamingArenaBreakoutArenaBreakout100,
  "gaming|arena breakout|arena breakout 25":
    cardGamingArenaBreakoutArenaBreakout25,
  "gaming|arena breakout|arena breakout 5":
    cardGamingArenaBreakoutArenaBreakout5,
  "gaming|arena breakout|arena breakout 50":
    cardGamingArenaBreakoutArenaBreakout50,
  "gaming|battle of kings|battle of kings 89.99":
    cardGamingBattleOfKingsBattleOfKings89P99,
  "gaming|blizzard|20": cardGamingBlizzard20,
  "gaming|blizzard|50": cardGamingBlizzard50,
  "gaming|blizzard|blizzard 20 usa": cardGamingBlizzard20,
  "gaming|blizzard|blizzard 50 usa": cardGamingBlizzard50,
  "gaming|climbing sand dune|climbing sand dune 19.79":
    cardGamingClimbingSandDuneClimbingSandDune19P79,
  "gaming|climbing sand dune|climbing sand dune 8.99":
    cardGamingClimbingSandDuneClimbingSandDune8P99,
  "gaming|climbing sand dune|climbing sand dune 89.99":
    cardGamingClimbingSandDuneClimbingSandDune89P99,
  "gaming|ea play|ea play 15 - usa (pc only)":
    cardGamingEaPlayEaPlay15UsaPcOnly,
  "gaming|ea play|ea play 25 - usa (pc only)":
    cardGamingEaPlayEaPlay25UsaPcOnly,
  "gaming|eve|eve online plex 1": cardGamingEveEveOnlinePlex1,
  "gaming|eve|eve online plex 2": cardGamingEveEveOnlinePlex2,
  "gaming|free fire|free fire 1": cardGamingFreeFireDirect100Plus10Diamonds,
  "gaming|free fire|free fire 10": cardGamingFreeFireDirect1080Plus108Diamonds,
  "gaming|free fire|free fire 2": cardGamingFreeFireDirect210Plus21Diamonds,
  "gaming|free fire|free fire 20": cardGamingFreeFireDirect2200Plus220Diamonds,
  "gaming|free fire|free fire 5": cardGamingFreeFireDirect530Plus30Diamonds,
  "gaming|free fire direct|100 +10 diamonds":
    cardGamingFreeFireDirect100Plus10Diamonds,
  "gaming|free fire direct|1080 +108 diamonds":
    cardGamingFreeFireDirect1080Plus108Diamonds,
  "gaming|free fire direct|210 +21 diamonds":
    cardGamingFreeFireDirect210Plus21Diamonds,
  "gaming|free fire direct|2200 +220 diamonds":
    cardGamingFreeFireDirect2200Plus220Diamonds,
  "gaming|free fire direct|530 +30 diamonds":
    cardGamingFreeFireDirect530Plus30Diamonds,
  "gaming|freefire voucher|100 diamonds":
    cardGamingFreeFireDirect100Plus10Diamonds,
  "gaming|freefire voucher|1080 diamonds":
    cardGamingFreeFireDirect1080Plus108Diamonds,
  "gaming|freefire voucher|210 diamonds":
    cardGamingFreeFireDirect210Plus21Diamonds,
  "gaming|freefire voucher|2200 diamonds":
    cardGamingFreeFireDirect2200Plus220Diamonds,
  "gaming|freefire voucher|530 diamonds":
    cardGamingFreeFireDirect530Plus30Diamonds,
  "gaming|gamestop|gamestop 10": cardGamingGamestopGamestop10,
  "gaming|gamestop|gamestop 100": cardGamingGamestopGamestop100,
  "gaming|gamestop|gamestop 25": cardGamingGamestopGamestop25,
  "gaming|gamestop|gamestop 5": cardGamingGamestopGamestop5,
  "gaming|gamestop|gamestop 50": cardGamingGamestopGamestop50,
  "gaming|legends of runeterra|legends of runeterra 14":
    cardGamingLegendsOfRuneterraLegendsOfRuneterra14,
  "gaming|legends of runeterra|legends of runeterra 28":
    cardGamingLegendsOfRuneterraLegendsOfRuneterra28,
  "gaming|ludo club cash|ludo club 1 - cash":
    cardGamingLudoClubCashLudoClub1Cash,
  "gaming|ludo club cash|ludo club 100 - cash":
    cardGamingLudoClubCashLudoClub100Cash,
  "gaming|ludo club cash|ludo club 2 - cash":
    cardGamingLudoClubCashLudoClub2Cash,
  "gaming|ludo club cash|ludo club 20 - cash":
    cardGamingLudoClubCashLudoClub20Cash,
  "gaming|ludo club cash|ludo club 5 - cash":
    cardGamingLudoClubCashLudoClub5Cash,
  "gaming|ludo club cash|ludo club 60 - cash":
    cardGamingLudoClubCashLudoClub60Cash,
  "gaming|ludo club coins|ludo club 1 - coins":
    cardGamingLudoClubCoinsLudoClub1Coins,
  "gaming|ludo club coins|ludo club 10 - coins":
    cardGamingLudoClubCoinsLudoClub10Coins,
  "gaming|ludo club coins|ludo club 100 - coins":
    cardGamingLudoClubCoinsLudoClub100Coins,
  "gaming|ludo club coins|ludo club 15 - coins":
    cardGamingLudoClubCoinsLudoClub15Coins,
  "gaming|ludo club coins|ludo club 2 - coins":
    cardGamingLudoClubCoinsLudoClub2Coins,
  "gaming|ludo club coins|ludo club 30 - coins":
    cardGamingLudoClubCoinsLudoClub30Coins,
  "gaming|nexon|nexon 10": cardGamingNexonNexon10,
  "gaming|nexon|nexon 100": cardGamingNexonNexon100,
  "gaming|nexon|nexon 15 - eu": cardGamingNexonNexon15Eu,
  "gaming|nexon|nexon 25": cardGamingNexonNexon25,
  "gaming|nexon|nexon 50": cardGamingNexonNexon50,
  "gaming|nintendo|10": cardGamingNintendo10,
  "gaming|nintendo|20": cardGamingNintendo20,
  "gaming|nintendo|35": cardGamingNintendo35,
  "gaming|nintendo|50": cardGamingNintendo50,
  "gaming|nintendo|nintendo eshop 10 -usa": cardGamingNintendo10,
  "gaming|nintendo|nintendo eshop 20 -usa": cardGamingNintendo20,
  "gaming|nintendo|nintendo eshop 35 -usa": cardGamingNintendo35,
  "gaming|nintendo|nintendo eshop 50 -usa": cardGamingNintendo50,
  "gaming|playstation ksa|psn 10 - ksa": cardGamingPlaystationKsaPsn10Ksa,
  "gaming|playstation ksa|psn 20 - ksa": cardGamingPlaystationKsaPsn20Ksa,
  "gaming|playstation ksa|psn 40 - ksa": cardGamingPlaystationKsaPsn40Ksa,
  "gaming|playstation ksa|psn 50 - ksa": cardGamingPlaystationKsaPsn50Ksa,
  "gaming|playstation ksa|psn 60 - ksa": cardGamingPlaystationKsaPsn60Ksa,
  "gaming|playstation leb|10 psn": cardGamingPlaystationLeb10Psn,
  "gaming|playstation leb|100 psn": cardGamingPlaystationLeb100Psn,
  "gaming|playstation leb|20 psn": cardGamingPlaystationLeb20Psn,
  "gaming|playstation leb|40 psn": cardGamingPlaystationLeb40Psn,
  "gaming|playstation leb|50 psn": cardGamingPlaystationLeb50Psn,
  "gaming|playstation leb|psn 10 - lebanon": cardGamingPlaystationLeb10Psn,
  "gaming|playstation leb|psn 100 - lebanon": cardGamingPlaystationLeb100Psn,
  "gaming|playstation leb|psn 20 - lebanon": cardGamingPlaystationLeb20Psn,
  "gaming|playstation leb|psn 40 - lebanon": cardGamingPlaystationLeb40Psn,
  "gaming|playstation leb|psn 50 - lebanon": cardGamingPlaystationLeb50Psn,
  "gaming|playstation uae|10 psn": cardGamingPlaystationUae10Psn,
  "gaming|playstation uae|100 psn": cardGamingPlaystationUae100Psn,
  "gaming|playstation uae|20 psn": cardGamingPlaystationUae20Psn,
  "gaming|playstation uae|40 psn": cardGamingPlaystationUae40Psn,
  "gaming|playstation uae|50 psn": cardGamingPlaystationUae50Psn,
  "gaming|playstation uae|60 psn": cardGamingPlaystationUae60Psn,
  "gaming|playstation uae|70 psn": cardGamingPlaystationUae70Psn,
  "gaming|playstation uae|psn 10 - uae": cardGamingPlaystationUae10Psn,
  "gaming|playstation uae|psn 100 - uae": cardGamingPlaystationUae100Psn,
  "gaming|playstation uae|psn 20 - uae": cardGamingPlaystationUae20Psn,
  "gaming|playstation uae|psn 40 - uae": cardGamingPlaystationUae40Psn,
  "gaming|playstation uae|psn 50 - uae": cardGamingPlaystationUae50Psn,
  "gaming|playstation uae|psn 60 - uae": cardGamingPlaystationUae60Psn,
  "gaming|playstation uae|psn 70 - uae": cardGamingPlaystationUae70Psn,
  "gaming|playstation usa|10 psn": cardGamingPlaystationUsa10Psn,
  "gaming|playstation usa|100 psn": cardGamingPlaystationUsa100Psn,
  "gaming|playstation usa|25 psn": cardGamingPlaystationUsa25Psn,
  "gaming|playstation usa|50 psn": cardGamingPlaystationUsa50Psn,
  "gaming|playstation usa|75 psn": cardGamingPlaystationUsa75Psn,
  "gaming|playstation usa|psn 10 - usa": cardGamingPlaystationUsa10Psn,
  "gaming|playstation usa|psn 100 - usa": cardGamingPlaystationUsa100Psn,
  "gaming|playstation usa|psn 25 - usa": cardGamingPlaystationUsa25Psn,
  "gaming|playstation usa|psn 50 - usa": cardGamingPlaystationUsa50Psn,
  "gaming|playstation usa|psn 75 - usa": cardGamingPlaystationUsa75Psn,
  "gaming|pubg direct|16200 uc": cardGamingPubgDirect16200Uc,
  "gaming|pubg direct|1800 uc": cardGamingPubgDirect1800Uc,
  "gaming|pubg direct|24300 uc": cardGamingPubgDirect24300Uc,
  "gaming|pubg direct|32400 uc": cardGamingPubgDirect32400Uc,
  "gaming|pubg direct|325 uc": cardGamingPubgDirect325Uc,
  "gaming|pubg direct|3850 uc": cardGamingPubgDirect3850Uc,
  "gaming|pubg direct|60": cardGamingPubgDirect60,
  "gaming|pubg direct|660 uc": cardGamingPubgDirect660Uc,
  "gaming|pubg direct|8100 uc": cardGamingPubgDirect8100Uc,
  "gaming|pubg mobile|pubg 1": cardGamingPubgDirect60,
  "gaming|pubg mobile|pubg 10": cardGamingPubgDirect660Uc,
  "gaming|pubg mobile|pubg 100": cardGamingPubgDirect8100Uc,
  "gaming|pubg mobile|pubg 200": cardGamingPubgDirect16200Uc,
  "gaming|pubg mobile|pubg 25": cardGamingPubgDirect1800Uc,
  "gaming|pubg mobile|pubg 300": cardGamingPubgDirect24300Uc,
  "gaming|pubg mobile|pubg 400": cardGamingPubgDirect32400Uc,
  "gaming|pubg mobile|pubg 5": cardGamingPubgDirect325Uc,
  "gaming|pubg mobile|pubg 50": cardGamingPubgDirect3850Uc,
  "gaming|pubg new state|pubg new state 51":
    cardGamingPubgNewStatePubgNewState51,
  "gaming|pubg voucher|12000uc +4200 free": cardGamingPubgDirect16200Uc,
  "gaming|pubg voucher|1500uc +300 free": cardGamingPubgDirect1800Uc,
  "gaming|pubg voucher|18000uc +6300 free": cardGamingPubgDirect24300Uc,
  "gaming|pubg voucher|24000uc +8400 free": cardGamingPubgDirect32400Uc,
  "gaming|pubg voucher|3000uc +850 free": cardGamingPubgDirect3850Uc,
  "gaming|pubg voucher|300uc +25 free": cardGamingPubgDirect325Uc,
  "gaming|pubg voucher|6000uc +2100 free": cardGamingPubgDirect8100Uc,
  "gaming|pubg voucher|600uc +60 free": cardGamingPubgDirect660Uc,
  "gaming|pubg voucher|60uc": cardGamingPubgDirect60,
  "gaming|razer gold|1": cardGamingRazerGold1,
  "gaming|razer gold|10": cardGamingRazerGold10,
  "gaming|razer gold|100": cardGamingRazerGold100,
  "gaming|razer gold|2": cardGamingRazerGold2,
  "gaming|razer gold|20": cardGamingRazerGold20,
  "gaming|razer gold|200": cardGamingRazerGold200,
  "gaming|razer gold|5": cardGamingRazerGold5,
  "gaming|razer gold|50": cardGamingRazerGold50,
  "gaming|razer gold|razer 1": cardGamingRazerGold1,
  "gaming|razer gold|razer 10": cardGamingRazerGold10,
  "gaming|razer gold|razer 100": cardGamingRazerGold100,
  "gaming|razer gold|razer 2": cardGamingRazerGold2,
  "gaming|razer gold|razer 20": cardGamingRazerGold20,
  "gaming|razer gold|razer 200": cardGamingRazerGold200,
  "gaming|razer gold|razer 5": cardGamingRazerGold5,
  "gaming|razer gold|razer 50": cardGamingRazerGold50,
  "gaming|riot usa|riot access usa - 10": cardGamingRiotUsaRiotAccessUsa10,
  "gaming|riot usa|riot access usa - 100": cardGamingRiotUsaRiotAccessUsa100,
  "gaming|riot usa|riot access usa - 20": cardGamingRiotUsaRiotAccessUsa20,
  "gaming|riot usa|riot access usa - 25": cardGamingRiotUsaRiotAccessUsa25,
  "gaming|riot usa|riot access usa - 35": cardGamingRiotUsaRiotAccessUsa35,
  "gaming|riot usa|riot access usa- 50": cardGamingRiotUsaRiotAccessUsa50,
  "gaming|roblox|10": cardGamingRoblox10,
  "gaming|roblox|100": cardGamingRoblox100,
  "gaming|roblox|25": cardGamingRoblox25,
  "gaming|roblox|50": cardGamingRoblox50,
  "gaming|roblox ksa|roblox 100 sar - ksa": cardGamingRobloxKsaRoblox100SarKsa,
  "gaming|roblox ksa|roblox 20 sar - ksa": cardGamingRobloxKsaRoblox20SarKsa,
  "gaming|roblox ksa|roblox 200 sar - ksa": cardGamingRobloxKsaRoblox200SarKsa,
  "gaming|roblox ksa|roblox 500 sar - ksa": cardGamingRobloxKsaRoblox500SarKsa,
  "gaming|roblox uae|roblox 100 aed - uae": cardGamingRobloxUaeRoblox100AedUae,
  "gaming|roblox uae|roblox 20 aed - uae": cardGamingRobloxUaeRoblox20AedUae,
  "gaming|roblox uae|roblox 200 aed - uae": cardGamingRobloxUaeRoblox200AedUae,
  "gaming|roblox uae|roblox 500 aed - uae": cardGamingRobloxUaeRoblox500AedUae,
  "gaming|roblox usa|roblox 10 - usa": cardGamingRoblox10,
  "gaming|roblox usa|roblox 100 - usa": cardGamingRoblox100,
  "gaming|roblox usa|roblox 25 - usa": cardGamingRoblox25,
  "gaming|roblox usa|roblox 50 - usa": cardGamingRoblox50,
  "gaming|runescape|runescape 10": cardGamingRunescapeRunescape10,
  "gaming|runescape|runescape 25": cardGamingRunescapeRunescape25,
  "gaming|steam|10": cardGamingSteam10,
  "gaming|steam|20": cardGamingSteam20,
  "gaming|steam|50": cardGamingSteam50,
  "gaming|steam uae|steam aed 200": cardGamingSteamUaeSteamAed200,
  "gaming|steam uae|steam aed 400": cardGamingSteamUaeSteamAed400,
  "gaming|steam uae|steam aed 50": cardGamingSteamUaeSteamAed50,
  "gaming|steam usa|steam 10": cardGamingSteam10,
  "gaming|steam usa|steam 100": cardGamingSteamUsaSteam100,
  "gaming|steam usa|steam 20": cardGamingSteam20,
  "gaming|steam usa|steam 50": cardGamingSteam50,
  "gaming|undawn|undawn 1": cardGamingUndawnUndawn1,
  "gaming|undawn|undawn 10": cardGamingUndawnUndawn10,
  "gaming|undawn|undawn 3": cardGamingUndawnUndawn3,
  "gaming|undawn|undawn 5": cardGamingUndawnUndawn5,
  "gaming|xbox|10": cardGamingXbox10,
  "gaming|xbox|100": cardGamingXbox100,
  "gaming|xbox|15": cardGamingXbox15,
  "gaming|xbox|20": cardGamingXbox20,
  "gaming|xbox|25": cardGamingXbox25,
  "gaming|xbox|5": cardGamingXbox5,
  "gaming|xbox|50": cardGamingXbox50,
  "gaming|xbox ksa|xbox 100 sar - ksa": cardGamingXboxKsaXbox100SarKsa,
  "gaming|xbox ksa|xbox 200 sar - ksa": cardGamingXboxKsaXbox200SarKsa,
  "gaming|xbox ksa|xbox 300 sar - ksa": cardGamingXboxKsaXbox300SarKsa,
  "gaming|xbox ksa|xbox 50 sar - ksa": cardGamingXboxKsaXbox50SarKsa,
  "gaming|xbox usa|xbox 10 - usa": cardGamingXbox10,
  "gaming|xbox usa|xbox 100 - usa": cardGamingXbox100,
  "gaming|xbox usa|xbox 15 - usa": cardGamingXbox15,
  "gaming|xbox usa|xbox 20 - usa": cardGamingXbox20,
  "gaming|xbox usa|xbox 25 - usa": cardGamingXbox25,
  "gaming|xbox usa|xbox 5 - usa": cardGamingXbox5,
  "gaming|xbox usa|xbox 50 - usa": cardGamingXbox50,
  "gift cards|discord|discord 10": cardGiftCardsDiscordDiscord10,
  "gift cards|discord|discord 100": cardGiftCardsDiscordDiscord100,
  "gift cards|discord|discord classic / basic 5":
    cardGiftCardsDiscordDiscordClassicBasic5,
  "gift cards|ebay|ebay 100 (not redeemable outside usa)":
    cardGiftCardsEbayEbay100NotRedeemableOutsideUsa,
  "gift cards|ebay|ebay 50 (not redeemable outside usa)":
    cardGiftCardsEbayEbay50NotRedeemableOutsideUsa,
  "gift cards|itunes ksa|itunes sar 150 - ksa":
    cardGiftCardsItunesKsaItunesSar150Ksa,
  "gift cards|itunes ksa|itunes sar 200 - ksa":
    cardGiftCardsItunesKsaItunesSar200Ksa,
  "gift cards|itunes ksa|itunes sar 250 - ksa":
    cardGiftCardsItunesKsaItunesSar250Ksa,
  "gift cards|itunes ksa|itunes sar 50 - ksa":
    cardGiftCardsItunesKsaItunesSar50Ksa,
  "gift cards|itunes ksa|itunes sar 500 - ksa":
    cardGiftCardsItunesKsaItunesSar500Ksa,
  "gift cards|itunes ksa|itunes sar 75 - ksa":
    cardGiftCardsItunesKsaItunesSar75Ksa,
  "gift cards|itunes uae|itunes aed 100 - uae":
    cardGiftCardsItunesUaeItunesAed100Uae,
  "gift cards|itunes uae|itunes aed 250 - uae":
    cardGiftCardsItunesUaeItunesAed250Uae,
  "gift cards|itunes uae|itunes aed 50 - uae":
    cardGiftCardsItunesUaeItunesAed50Uae,
  "gift cards|itunes uae|itunes aed 500 - uae":
    cardGiftCardsItunesUaeItunesAed500Uae,
  "gift cards|itunes usa|itunes 10 - usa": cardGiftCardsItunesUsaItunes10Usa,
  "gift cards|itunes usa|itunes 100 - usa": cardGiftCardsItunesUsaItunes100Usa,
  "gift cards|itunes usa|itunes 15 - usa": cardGiftCardsItunesUsaItunes15Usa,
  "gift cards|itunes usa|itunes 20 - usa": cardGiftCardsItunesUsaItunes20Usa,
  "gift cards|itunes usa|itunes 25 - usa": cardGiftCardsItunesUsaItunes25Usa,
  "gift cards|itunes usa|itunes 400 - usa": cardGiftCardsItunesUsaItunes400Usa,
  "gift cards|itunes usa|itunes 5 - usa": cardGiftCardsItunesUsaItunes5Usa,
  "gift cards|itunes usa|itunes 50 - usa": cardGiftCardsItunesUsaItunes50Usa,
  "gift cards|norton|norton 360 deluxe 25gb - 12m":
    cardGiftCardsNortonNorton360Deluxe25Gb12M,
  "gift cards|norton|norton 360 premium 75gb - 12m":
    cardGiftCardsNortonNorton360Premium75Gb12M,
  "gift cards|shein|shein e-gift card 100": cardGiftCardsSheinSheinEGiftCard100,
  "gift cards|shein|shein e-gift card 300": cardGiftCardsSheinSheinEGiftCard300,
  "gift cards|shein|shein e-gift card 500": cardGiftCardsSheinSheinEGiftCard500,
  "gift cards|shein|shein e-gift card 800": cardGiftCardsSheinSheinEGiftCard800,
  "gift cards|yalla live|yalla live 100": cardGiftCardsYallaLiveYallaLive100,
  "gift cards|yalla live|yalla live 25": cardGiftCardsYallaLiveYallaLive25,
  "gift cards|yalla live|yalla live 300": cardGiftCardsYallaLiveYallaLive300,
  "gift cards|yalla live|yalla live 50": cardGiftCardsYallaLiveYallaLive50,
  "gift cards|yalla live|yalla live 500": cardGiftCardsYallaLiveYallaLive500,
  "internet|connect|connect dsl 4m / 85 gb":
    cardInternetConnectConnectDsl4M85Gb,
  "internet|connect|connect dsl 4mb - 85gb - fnt":
    cardInternetConnectConnectDsl4Mb85GbFnt,
  "internet|connect|connect dsl 6m unlimited":
    cardInternetConnectConnectDsl6MUnlimited,
  "internet|connect|connect dsl 8m unlimited":
    cardInternetConnectConnectDsl8MUnlimited,
  "internet|connect|connect dsl freeze": cardInternetConnectConnectDslFreeze,
  "internet|connect|connect dsl open speed 160 gb":
    cardInternetConnectConnectDslOpenSpeed160Gb,
  "internet|connect|connect dsl open speed 320 gb":
    cardInternetConnectConnectDslOpenSpeed320Gb,
  "internet|connect|connect dsl open speed 500 gb":
    cardInternetConnectConnectDslOpenSpeed500Gb,
  "internet|connect|connect dsl os 160gb + fnt":
    cardInternetConnectConnectDslOs160GbPlusFnt,
  "internet|connect|connect dsl os 320gb + fnt":
    cardInternetConnectConnectDslOs320GbPlusFnt,
  "internet|connect|connect dsl os 500gb + fnt":
    cardInternetConnectConnectDslOs500GbPlusFnt,
  "internet|connect|connect fiber 1100 gb":
    cardInternetConnectConnectFiber1100Gb,
  "internet|connect|connect fiber 1100gb + fnt":
    cardInternetConnectConnectFiber1100GbPlusFnt,
  "internet|connect|connect fiber 330 gb": cardInternetConnectConnectFiber330Gb,
  "internet|connect|connect fiber 330gb + fnt":
    cardInternetConnectConnectFiber330GbPlusFnt,
  "internet|connect|connect fiber 550 gb": cardInternetConnectConnectFiber550Gb,
  "internet|connect|connect fiber 550gb + fnt":
    cardInternetConnectConnectFiber550GbPlusFnt,
  "internet|connect|connect fiber 825 gb": cardInternetConnectConnectFiber825Gb,
  "internet|connect|connect fiber 825gb + fnt":
    cardInternetConnectConnectFiber825GbPlusFnt,
  "internet|connect|connect fiber freeze":
    cardInternetConnectConnectFiberFreeze,
  "internet|connect|connect fwa basic 10mbps 100gb":
    cardInternetConnectConnectFwaBasic10Mbps100Gb,
  "internet|connect|connect fwa freeze": cardInternetConnectConnectFwaFreeze,
  "internet|connect|connect fwa gold 10mbps 300gb":
    cardInternetConnectConnectFwaGold10Mbps300Gb,
  "internet|connect|connect fwa platinum 10 mbps 450gb":
    cardInternetConnectConnectFwaPlatinum10Mbps450Gb,
  "internet|connect|connect fwa silver 10mbps 145gb":
    cardInternetConnectConnectFwaSilver10Mbps145Gb,
  "internet|connect|connect fwa smart unlimited 5gb":
    cardInternetConnectConnectFwaSmartUnlimited5Gb,
  "internet|connect|connect fwa smart unlimited 8gb":
    cardInternetConnectConnectFwaSmartUnlimited8Gb,
  "internet|mobi|4mb 80gb": cardInternetMobi4Mb80Gb,
  "internet|mobi|4mb 80gb fnq": cardInternetMobi4Mb80GbFnq,
  "internet|mobi|4mb 80gb free night": cardInternetMobi4Mb80GbFnq,
  "internet|mobi|4mb unl": cardInternetMobi4MbUnl,
  "internet|mobi|6mb unl": cardInternetMobi6MbUnl,
  "internet|mobi|8mb unl": cardInternetMobi8MbUnl,
  "internet|mobi|mobi dsl 4 mbps unlimited": cardInternetMobi4MbUnl,
  "internet|mobi|mobi dsl 6 mbps unlimited": cardInternetMobi6MbUnl,
  "internet|mobi|mobi dsl 8 mbps unlimited": cardInternetMobi8MbUnl,
  "internet|mobi|mobi dsl lite 4 mbps 80 gb": cardInternetMobi4Mb80Gb,
  "internet|mobi|mobi dsl lite 4 mbps 80 gb fnq": cardInternetMobi4Mb80GbFnq,
  "internet|mobi|mobi dsl open play unlimited":
    cardInternetMobiMobiDslOpenPlayUnlimited,
  "internet|mobi|mobi dsl os 100 gb fnq": cardInternetMobiOs100GbFnq,
  "internet|mobi|mobi dsl os 115 gb fnq": cardInternetMobiMobiDslOs115GbFnq,
  "internet|mobi|mobi dsl os 175 gb fnq": cardInternetMobiMobiDslOs175GbFnq,
  "internet|mobi|mobi dsl os 220 gb fnq": cardInternetMobiMobiDslOs220GbFnq,
  "internet|mobi|mobi dsl os 330 gb fnq": cardInternetMobiMobiDslOs330GbFnq,
  "internet|mobi|mobi dsl os 440 gb fnq": cardInternetMobiMobiDslOs440GbFnq,
  "internet|mobi|mobi dsl os 550 gb fnq": cardInternetMobiMobiDslOs550GbFnq,
  "internet|mobi|mobi dsl os lite 80 gb": cardInternetMobiOs80Gb,
  "internet|mobi|mobi dsl os lite 80 gb fnq": cardInternetMobiOs80GbFnq,
  "internet|mobi|mobi fiber 1000 gb fnq": cardInternetMobiMobiFiber1000GbFnq,
  "internet|mobi|mobi fiber 1500 gb fnq": cardInternetMobiMobiFiber1500GbFnq,
  "internet|mobi|mobi fiber 2000 gb fnq": cardInternetMobiMobiFiber2000GbFnq,
  "internet|mobi|mobi fiber 2500 gb fnq": cardInternetMobiMobiFiber2500GbFnq,
  "internet|mobi|mobi fiber 300 gb": cardInternetMobiMobiFiber300Gb,
  "internet|mobi|mobi fiber 400 gb fnq": cardInternetMobiMobiFiber400GbFnq,
  "internet|mobi|mobi fiber 500 gb fnq": cardInternetMobiMobiFiber500GbFnq,
  "internet|mobi|mobi fiber 600 gb fnq": cardInternetMobiMobiFiber600GbFnq,
  "internet|mobi|mobi fiber 800 gb fnq": cardInternetMobiMobiFiber800GbFnq,
  "internet|mobi|mobi fiber lite 150 gb": cardInternetMobiMobiFiberLite150Gb,
  "internet|mobi|mobi fiber unlimited": cardInternetMobiMobiFiberUnlimited,
  "internet|mobi|os 100gb fnq": cardInternetMobiOs100GbFnq,
  "internet|mobi|os 100gb free night": cardInternetMobiOs100GbFnq,
  "internet|mobi|os 80gb": cardInternetMobiOs80Gb,
  "internet|mobi|os 80gb fnq": cardInternetMobiOs80GbFnq,
  "internet|mobi|os 80gb free night": cardInternetMobiOs80GbFnq,
  "internet|terranet|4mb 100gb": cardInternetTerranet4Mb100Gb,
  "internet|terranet|4mb unl os 160gb": cardInternetTerranet4MbUnlOs160Gb,
  "internet|terranet|4mb/100gb os 100gb": cardInternetTerranet4Mb100Gb,
  "internet|terranet|6mb unl os 200gb": cardInternetTerranet6MbUnlOs200Gb,
  "internet|terranet|8mb unl play": cardInternetTerranet8MbUnlPlay,
  "internet|terranet|army dsl 4mb 100gb": cardInternetTerranetArmyDsl4Mb100Gb,
  "internet|terranet|army dsl 8mb unl/play":
    cardInternetTerranetArmyDsl8MbUnlPlay,
  "internet|terranet|army dsl os 120gb": cardInternetTerranetArmyDslOs120Gb,
  "internet|terranet|army dsl os 160gb/4mb unl":
    cardInternetTerranetArmyDslOs160Gb4MbUnl,
  "internet|terranet|army dsl os 200gb/6mb unl":
    cardInternetTerranetArmyDslOs200Gb6MbUnl,
  "internet|terranet|army dsl os 240gb": cardInternetTerranetArmyDslOs240Gb,
  "internet|terranet|army dsl os 400gb": cardInternetTerranetArmyDslOs400Gb,
  "internet|terranet|army dsl os 500gb": cardInternetTerranetArmyDslOs500Gb,
  "internet|terranet|dsl extra volume 5gb":
    cardInternetTerranetDslExtraVolume5Gb,
  "internet|terranet|fiber 1000gb": cardInternetTerranetFiber300Mb1000Gb,
  "internet|terranet|fiber 1500gb": cardInternetTerranetFiber300Mb1500Gb,
  "internet|terranet|fiber 2000gb": cardInternetTerranetFiber300Mb2000Gb,
  "internet|terranet|fiber 2500gb": cardInternetTerranetFiber300Mb2500Gb,
  "internet|terranet|fiber 300gb": cardInternetTerranetFiber300Mb300Gb,
  "internet|terranet|fiber 300mb 1000gb": cardInternetTerranetFiber300Mb1000Gb,
  "internet|terranet|fiber 300mb 1500gb": cardInternetTerranetFiber300Mb1500Gb,
  "internet|terranet|fiber 300mb 2000gb": cardInternetTerranetFiber300Mb2000Gb,
  "internet|terranet|fiber 300mb 2500gb": cardInternetTerranetFiber300Mb2500Gb,
  "internet|terranet|fiber 300mb 300gb": cardInternetTerranetFiber300Mb300Gb,
  "internet|terranet|fiber 300mb 400gb": cardInternetTerranetFiber300Mb400Gb,
  "internet|terranet|fiber 300mb 500gb": cardInternetTerranetFiber300Mb500Gb,
  "internet|terranet|fiber 300mb 850gb": cardInternetTerranetFiber300Mb850Gb,
  "internet|terranet|fiber 400gb": cardInternetTerranetFiber300Mb400Gb,
  "internet|terranet|fiber 500gb": cardInternetTerranetFiber300Mb500Gb,
  "internet|terranet|fiber 50mb unl": cardInternetTerranetFiber50MbUnl,
  "internet|terranet|fiber 850gb": cardInternetTerranetFiber300Mb850Gb,
  "internet|terranet|open speed 1000gb": cardInternetTerranetOpenSpeed1000Gb,
  "internet|terranet|open speed 120gb": cardInternetTerranetOpenSpeed120Gb,
  "internet|terranet|open speed 240gb": cardInternetTerranetOpenSpeed240Gb,
  "internet|terranet|open speed 400gb": cardInternetTerranetOpenSpeed400Gb,
  "internet|terranet|open speed 500gb": cardInternetTerranetOpenSpeed500Gb,
  "internet|terranet|os 1000gb": cardInternetTerranetOpenSpeed1000Gb,
  "internet|terranet|os 120gb": cardInternetTerranetOpenSpeed120Gb,
  "internet|terranet|os 160gb/4mb unl/smart": cardInternetTerranet4MbUnlOs160Gb,
  "internet|terranet|os 200gb/6mb unl/home": cardInternetTerranet6MbUnlOs200Gb,
  "internet|terranet|os 240gb": cardInternetTerranetOpenSpeed240Gb,
  "internet|terranet|os 400gb": cardInternetTerranetOpenSpeed400Gb,
  "internet|terranet|os 500gb": cardInternetTerranetOpenSpeed500Gb,
  "internet|terranet|terr army dsl 4mb 100gb":
    cardInternetTerranetArmyDsl4Mb100Gb,
  "internet|terranet|terr army dsl 4mb 60gb":
    cardInternetTerranetTerrArmyDsl4Mb60Gb,
  "internet|terranet|terr army dsl 8mb unlimited / play":
    cardInternetTerranetArmyDsl8MbUnlPlay,
  "internet|terranet|terr army dsl os 120gb":
    cardInternetTerranetArmyDslOs120Gb,
  "internet|terranet|terr army dsl os 160gb / 4mb unlimited / smart":
    cardInternetTerranetArmyDslOs160Gb4MbUnl,
  "internet|terranet|terr army dsl os 200gb / 6mb unlimited / home":
    cardInternetTerranetArmyDslOs200Gb6MbUnl,
  "internet|terranet|terr army dsl os 240gb":
    cardInternetTerranetArmyDslOs240Gb,
  "internet|terranet|terr army dsl os 400gb":
    cardInternetTerranetArmyDslOs400Gb,
  "internet|terranet|terr army dsl os 500gb":
    cardInternetTerranetArmyDslOs500Gb,
  "internet|terranet|terr dsl 4mb 60gb": cardInternetTerranetTerrDsl4Mb60Gb,
  "internet|terranet|terr dsl 8mb unlimited / play":
    cardInternetTerranet8MbUnlPlay,
  "internet|terranet|terr dsl extra volume 5gb":
    cardInternetTerranetDslExtraVolume5Gb,
  "internet|terranet|terr dsl os 1000gb": cardInternetTerranetOpenSpeed1000Gb,
  "internet|terranet|terr dsl os 100gb / 4mb 100gb":
    cardInternetTerranet4Mb100Gb,
  "internet|terranet|terr dsl os 120gb": cardInternetTerranetOpenSpeed120Gb,
  "internet|terranet|terr dsl os 160gb / 4mb unlimited / smart":
    cardInternetTerranet4MbUnlOs160Gb,
  "internet|terranet|terr dsl os 200gb / 6mb unlimited / home":
    cardInternetTerranet6MbUnlOs200Gb,
  "internet|terranet|terr dsl os 240gb": cardInternetTerranetOpenSpeed240Gb,
  "internet|terranet|terr dsl os 400gb": cardInternetTerranetOpenSpeed400Gb,
  "internet|terranet|terr dsl os 500gb": cardInternetTerranetOpenSpeed500Gb,
  "internet|terranet|terr fiber 1000gb": cardInternetTerranetFiber300Mb1000Gb,
  "internet|terranet|terr fiber 1500gb": cardInternetTerranetFiber300Mb1500Gb,
  "internet|terranet|terr fiber 2000gb": cardInternetTerranetFiber300Mb2000Gb,
  "internet|terranet|terr fiber 2500gb": cardInternetTerranetFiber300Mb2500Gb,
  "internet|terranet|terr fiber 300gb": cardInternetTerranetFiber300Mb300Gb,
  "internet|terranet|terr fiber 400gb": cardInternetTerranetFiber300Mb400Gb,
  "internet|terranet|terr fiber 50 mb unlimited":
    cardInternetTerranetFiber50MbUnl,
  "internet|terranet|terr fiber 500gb": cardInternetTerranetFiber300Mb500Gb,
  "internet|terranet|terr fiber 850gb": cardInternetTerranetFiber300Mb850Gb,
  "internet|wise|11100": cardInternetWise11100,
  "internet|wise|2890": cardInternetWise2890,
  "internet|wise|5780": cardInternetWise5780,
  "internet|wise|8000": cardInternetWise8000,
  "internet|wise|wise 11100": cardInternetWise11100,
  "internet|wise|wise 2890": cardInternetWise2890,
  "internet|wise|wise 5780": cardInternetWise5780,
  "internet|wise|wise 8000": cardInternetWise8000,
  "mtc|prepaid|1.67": cardMtc1P67,
  "mtc|prepaid|10": cardMtcPrepaid10,
  "mtc|prepaid|15.15": cardMtc15P15,
  "mtc|prepaid|22.73": cardMtc22P73,
  "mtc|prepaid|3.79": cardMtc3P79,
  "mtc|prepaid|4.5": cardMtc4P5,
  "mtc|prepaid|7.58": cardMtc7P58,
  "mtc|prepaid|77.28": cardMtc77P28,
  "mtc|prepaid|smart": cardMtcPrepaidSmart,
  "mtc|prepaid|start": cardMtcStart,
  "mtc|prepaid|startsos": cardMtcPrepaidStartsos,
  "mtc|prepaid|super": cardMtcPrepaidSuper,
  "mtc|validity|180 days": cardMtcValidity180Days,
  "mtc|validity|30 days": cardMtcValidity30Days,
  "mtc|validity|360 days": cardMtcValidity360Days,
  "mtc|validity|60 days": cardMtcValidity60Days,
  "mtc|validity|90 days": cardMtcValidity90Days,
  "streaming|anghami|anghami family 12m": cardStreamingAnghamiAnghamiFamily12M,
  "streaming|anghami|anghami family 1m": cardStreamingAnghamiAnghamiFamily1M,
  "streaming|anghami|anghami gold 12m": cardStreamingAnghamiAnghamiGold12M,
  "streaming|anghami|anghami gold 1m": cardStreamingAnghamiAnghamiGold1M,
  "streaming|anghami|anghami plus 12m": cardStreamingAnghamiAnghamiPlus12M,
  "streaming|anghami|anghami plus 1m": cardStreamingAnghamiAnghamiPlus1M,
  "streaming|anghami|anghami plus 3m": cardStreamingAnghamiAnghamiPlus3M,
  "streaming|anghami|anghami plus 6m": cardStreamingAnghamiAnghamiPlus6M,
  "streaming|mbc shahid|shahid vip - 12m - lebanon":
    cardStreamingMbcShahidShahidVip12MLebanon,
  "streaming|mbc shahid|shahid vip - 3m - lebanon":
    cardStreamingMbcShahidShahidVip3MLebanon,
  "streaming|mbc shahid uae|shahid vip - 12m - uae":
    cardStreamingMbcShahidUaeShahidVip12MUae,
  "streaming|mbc shahid uae|shahid vip - 3m - uae":
    cardStreamingMbcShahidUaeShahidVip3MUae,
  "streaming|netflix uae|netflix 100 aed - uae only":
    cardStreamingNetflixUaeNetflix100AedUaeOnly,
  "streaming|netflix uae|netflix 500 aed - uae only":
    cardStreamingNetflixUaeNetflix500AedUaeOnly,
  "streaming|netflix usa|netflix 15": cardStreamingNetflixUsaNetflix15,
  "streaming|netflix usa|netflix 20": cardStreamingNetflixUsaNetflix20,
  "streaming|netflix usa|netflix 25": cardStreamingNetflixUsaNetflix25,
  "streaming|netflix usa|netflix 30": cardStreamingNetflixUsaNetflix30,
  "streaming|netflix usa|netflix 50": cardStreamingNetflixUsaNetflix50,
  "streaming|osn+ lebanon|osn+ premium 12m - lebanon":
    cardStreamingOsnPlusLebanonOsnPlusPremium12MLebanon,
  "streaming|osn+ lebanon|osn+ premium 1m - lebanon":
    cardStreamingOsnPlusLebanonOsnPlusPremium1MLebanon,
  "streaming|osn+ lebanon|osn+ premium 3m - lebanon":
    cardStreamingOsnPlusLebanonOsnPlusPremium3MLebanon,
  "streaming|osn+ lebanon|osn+ premium 6m - lebanon":
    cardStreamingOsnPlusLebanonOsnPlusPremium6MLebanon,
  "streaming|osn+ lebanon|osn+ standard 12m - lebanon":
    cardStreamingOsnPlusLebanonOsnPlusStandard12MLebanon,
  "streaming|osn+ lebanon|osn+ standard 1m - lebanon":
    cardStreamingOsnPlusLebanonOsnPlusStandard1MLebanon,
  "streaming|osn+ lebanon|osn+ standard 3m - lebanon":
    cardStreamingOsnPlusLebanonOsnPlusStandard3MLebanon,
  "streaming|osn+ lebanon|osn+ standard 6m - lebanon":
    cardStreamingOsnPlusLebanonOsnPlusStandard6MLebanon,
  "streaming|podu|podu 10.35": cardStreamingPoduPodu10P35,
  "streaming|podu|podu 5.14": cardStreamingPoduPodu5P14,
  "streaming|starzplay|starzplay 12m": cardStreamingStarzplayStarzplay12M,
  "streaming|starzplay|starzplay 3m": cardStreamingStarzplayStarzplay3M,
  "streaming|starzplay|starzplay 6m": cardStreamingStarzplayStarzplay6M,
  "streaming|starzplay uae|starzplay 100 aed - 3m - uae":
    cardStreamingStarzplayUaeStarzplay100Aed3MUae,
  "streaming|starzplay uae|starzplay 195 aed - 6m - uae":
    cardStreamingStarzplayUaeStarzplay195Aed6MUae,
  "streaming|starzplay uae|starzplay 330 aed - 12m - uae":
    cardStreamingStarzplayUaeStarzplay330Aed12MUae,
  "streaming|starzplay uae|starzplay 40 aed - 1m - uae":
    cardStreamingStarzplayUaeStarzplay40Aed1MUae,
  "streaming|twitch|twitch 100 (not redeemable outside usa)":
    cardStreamingTwitchTwitch100NotRedeemableOutsideUsa,
  "streaming|twitch|twitch 50 (not redeemable outside usa)":
    cardStreamingTwitchTwitch50NotRedeemableOutsideUsa,
  "telecom|du uae|du pin 110 aed": cardTelecomDuUaeDuPin110Aed,
  "telecom|du uae|du pin 210 aed": cardTelecomDuUaeDuPin210Aed,
  "telecom|du uae|du pin 25 aed": cardTelecomDuUaeDuPin25Aed,
  "telecom|du uae|du pin 525 aed": cardTelecomDuUaeDuPin525Aed,
  "telecom|du uae|du pin 55 aed": cardTelecomDuUaeDuPin55Aed,
  "telecom|etisalat uae|etisalat pin 110 aed":
    cardTelecomEtisalatUaeEtisalatPin110Aed,
  "telecom|etisalat uae|etisalat pin 210 aed":
    cardTelecomEtisalatUaeEtisalatPin210Aed,
  "telecom|etisalat uae|etisalat pin 30 aed":
    cardTelecomEtisalatUaeEtisalatPin30Aed,
  "telecom|etisalat uae|etisalat pin 525 aed":
    cardTelecomEtisalatUaeEtisalatPin525Aed,
  "telecom|etisalat uae|etisalat pin 55 aed":
    cardTelecomEtisalatUaeEtisalatPin55Aed,
  "telecom|stc ksa|stc sar 100": cardTelecomStcKsaStcSar100,
  "telecom|stc ksa|stc sar 17.39": cardTelecomStcKsaStcSar17P39,
  "telecom|stc ksa|stc sar 20": cardTelecomStcKsaStcSar20,
  "telecom|stc ksa|stc sar 200": cardTelecomStcKsaStcSar200,
  "telecom|stc ksa|stc sar 30": cardTelecomStcKsaStcSar30,
  "telecom|stc ksa|stc sar 300": cardTelecomStcKsaStcSar300,
  "telecom|stc ksa|stc sar 50": cardTelecomStcKsaStcSar50,
  "transportation|actc|actc 100": cardTransportationActcActc100,
  "transportation|actc|actc 130": cardTransportationActcActc130,
  "transportation|actc|actc 150": cardTransportationActcActc150,
  "transportation|actc|actc 200": cardTransportationActcActc200,
  "transportation|actc|actc 80": cardTransportationActcActc80,
};
