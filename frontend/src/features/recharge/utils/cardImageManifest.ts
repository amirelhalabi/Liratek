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
import cardAlfaPrepaid1P22 from "@/assets/cards/alfa-prepaid-1.22.jpg";
import cardAlfaPrepaid10 from "@/assets/cards/alfa-prepaid-10.jpg";
import cardAlfaPrepaid4P5 from "@/assets/cards/alfa-prepaid-4.5.jpg";
import cardAlfaSurfAndTalk4X4 from "@/assets/cards/alfa-surf-and-talk-4x4.jpg";
import cardAlfaSurfAndTalk5X5 from "@/assets/cards/alfa-surf-and-talk-5x5.jpg";
import cardAlfaWeekenderTheWeekender from "@/assets/cards/alfa-weekender-the-weekender.jpg";
import cardAlfaWeeklyData1P5Gb from "@/assets/cards/alfa-weekly-data-1.5gb.jpg";
import cardAlfaWeeklyData500Mb from "@/assets/cards/alfa-weekly-data-500mb.jpg";
import cardAlfaWeeklyData5Gb from "@/assets/cards/alfa-weekly-data-5gb.jpg";
import cardGamingBlizzard20 from "@/assets/cards/gaming-blizzard-20.jpg";
import cardGamingBlizzard50 from "@/assets/cards/gaming-blizzard-50.jpg";
import cardGamingFreeFireDirect100Plus10Diamonds from "@/assets/cards/gaming-free-fire-direct-100-plus-10-diamonds.jpg";
import cardGamingFreeFireDirect1080Plus108Diamonds from "@/assets/cards/gaming-free-fire-direct-1080-plus-108-diamonds.jpg";
import cardGamingFreeFireDirect210Plus21Diamonds from "@/assets/cards/gaming-free-fire-direct-210-plus-21-diamonds.jpg";
import cardGamingFreeFireDirect2200Plus220Diamonds from "@/assets/cards/gaming-free-fire-direct-2200-plus-220-diamonds.jpg";
import cardGamingFreeFireDirect530Plus30Diamonds from "@/assets/cards/gaming-free-fire-direct-530-plus-30-diamonds.jpg";
import cardGamingNintendo10 from "@/assets/cards/gaming-nintendo-10.jpg";
import cardGamingNintendo20 from "@/assets/cards/gaming-nintendo-20.jpg";
import cardGamingNintendo35 from "@/assets/cards/gaming-nintendo-35.jpg";
import cardGamingNintendo50 from "@/assets/cards/gaming-nintendo-50.jpg";
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
import cardGamingRazerGold1 from "@/assets/cards/gaming-razer-gold-1.jpg";
import cardGamingRazerGold10 from "@/assets/cards/gaming-razer-gold-10.jpg";
import cardGamingRazerGold100 from "@/assets/cards/gaming-razer-gold-100.jpg";
import cardGamingRazerGold2 from "@/assets/cards/gaming-razer-gold-2.jpg";
import cardGamingRazerGold20 from "@/assets/cards/gaming-razer-gold-20.jpg";
import cardGamingRazerGold200 from "@/assets/cards/gaming-razer-gold-200.jpg";
import cardGamingRazerGold5 from "@/assets/cards/gaming-razer-gold-5.jpg";
import cardGamingRazerGold50 from "@/assets/cards/gaming-razer-gold-50.jpg";
import cardGamingRoblox10 from "@/assets/cards/gaming-roblox-10.jpg";
import cardGamingRoblox100 from "@/assets/cards/gaming-roblox-100.jpg";
import cardGamingRoblox25 from "@/assets/cards/gaming-roblox-25.jpg";
import cardGamingRoblox50 from "@/assets/cards/gaming-roblox-50.jpg";
import cardGamingSteam10 from "@/assets/cards/gaming-steam-10.jpg";
import cardGamingSteam20 from "@/assets/cards/gaming-steam-20.jpg";
import cardGamingSteam50 from "@/assets/cards/gaming-steam-50.jpg";
import cardGamingXbox10 from "@/assets/cards/gaming-xbox-10.jpg";
import cardGamingXbox100 from "@/assets/cards/gaming-xbox-100.jpg";
import cardGamingXbox15 from "@/assets/cards/gaming-xbox-15.jpg";
import cardGamingXbox20 from "@/assets/cards/gaming-xbox-20.jpg";
import cardGamingXbox25 from "@/assets/cards/gaming-xbox-25.jpg";
import cardGamingXbox5 from "@/assets/cards/gaming-xbox-5.jpg";
import cardGamingXbox50 from "@/assets/cards/gaming-xbox-50.jpg";
import cardInternetMobi4Mb80GbFnq from "@/assets/cards/internet-mobi-4mb-80gb-fnq.jpg";
import cardInternetMobi4Mb80Gb from "@/assets/cards/internet-mobi-4mb-80gb.jpg";
import cardInternetMobi4MbUnl from "@/assets/cards/internet-mobi-4mb-unl.jpg";
import cardInternetMobi6MbUnl from "@/assets/cards/internet-mobi-6mb-unl.jpg";
import cardInternetMobi8MbUnl from "@/assets/cards/internet-mobi-8mb-unl.jpg";
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
  "gaming|blizzard|20": cardGamingBlizzard20,
  "gaming|blizzard|50": cardGamingBlizzard50,
  "gaming|free fire direct|100 +10 diamonds": cardGamingFreeFireDirect100Plus10Diamonds,
  "gaming|free fire direct|1080 +108 diamonds": cardGamingFreeFireDirect1080Plus108Diamonds,
  "gaming|free fire direct|210 +21 diamonds": cardGamingFreeFireDirect210Plus21Diamonds,
  "gaming|free fire direct|2200 +220 diamonds": cardGamingFreeFireDirect2200Plus220Diamonds,
  "gaming|free fire direct|530 +30 diamonds": cardGamingFreeFireDirect530Plus30Diamonds,
  "gaming|freefire voucher|100 diamonds": cardGamingFreeFireDirect100Plus10Diamonds,
  "gaming|freefire voucher|1080 diamonds": cardGamingFreeFireDirect1080Plus108Diamonds,
  "gaming|freefire voucher|210 diamonds": cardGamingFreeFireDirect210Plus21Diamonds,
  "gaming|freefire voucher|2200 diamonds": cardGamingFreeFireDirect2200Plus220Diamonds,
  "gaming|freefire voucher|530 diamonds": cardGamingFreeFireDirect530Plus30Diamonds,
  "gaming|nintendo|10": cardGamingNintendo10,
  "gaming|nintendo|20": cardGamingNintendo20,
  "gaming|nintendo|35": cardGamingNintendo35,
  "gaming|nintendo|50": cardGamingNintendo50,
  "gaming|playstation leb|10 psn": cardGamingPlaystationLeb10Psn,
  "gaming|playstation leb|100 psn": cardGamingPlaystationLeb100Psn,
  "gaming|playstation leb|20 psn": cardGamingPlaystationLeb20Psn,
  "gaming|playstation leb|40 psn": cardGamingPlaystationLeb40Psn,
  "gaming|playstation leb|50 psn": cardGamingPlaystationLeb50Psn,
  "gaming|playstation uae|10 psn": cardGamingPlaystationUae10Psn,
  "gaming|playstation uae|100 psn": cardGamingPlaystationUae100Psn,
  "gaming|playstation uae|20 psn": cardGamingPlaystationUae20Psn,
  "gaming|playstation uae|40 psn": cardGamingPlaystationUae40Psn,
  "gaming|playstation uae|50 psn": cardGamingPlaystationUae50Psn,
  "gaming|playstation uae|60 psn": cardGamingPlaystationUae60Psn,
  "gaming|playstation uae|70 psn": cardGamingPlaystationUae70Psn,
  "gaming|playstation usa|10 psn": cardGamingPlaystationUsa10Psn,
  "gaming|playstation usa|100 psn": cardGamingPlaystationUsa100Psn,
  "gaming|playstation usa|25 psn": cardGamingPlaystationUsa25Psn,
  "gaming|playstation usa|50 psn": cardGamingPlaystationUsa50Psn,
  "gaming|playstation usa|75 psn": cardGamingPlaystationUsa75Psn,
  "gaming|pubg direct|16200 uc": cardGamingPubgDirect16200Uc,
  "gaming|pubg direct|1800 uc": cardGamingPubgDirect1800Uc,
  "gaming|pubg direct|24300 uc": cardGamingPubgDirect24300Uc,
  "gaming|pubg direct|32400 uc": cardGamingPubgDirect32400Uc,
  "gaming|pubg direct|325 uc": cardGamingPubgDirect325Uc,
  "gaming|pubg direct|3850 uc": cardGamingPubgDirect3850Uc,
  "gaming|pubg direct|60": cardGamingPubgDirect60,
  "gaming|pubg direct|660 uc": cardGamingPubgDirect660Uc,
  "gaming|pubg direct|8100 uc": cardGamingPubgDirect8100Uc,
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
  "gaming|roblox|10": cardGamingRoblox10,
  "gaming|roblox|100": cardGamingRoblox100,
  "gaming|roblox|25": cardGamingRoblox25,
  "gaming|roblox|50": cardGamingRoblox50,
  "gaming|steam|10": cardGamingSteam10,
  "gaming|steam|20": cardGamingSteam20,
  "gaming|steam|50": cardGamingSteam50,
  "gaming|xbox|10": cardGamingXbox10,
  "gaming|xbox|100": cardGamingXbox100,
  "gaming|xbox|15": cardGamingXbox15,
  "gaming|xbox|20": cardGamingXbox20,
  "gaming|xbox|25": cardGamingXbox25,
  "gaming|xbox|5": cardGamingXbox5,
  "gaming|xbox|50": cardGamingXbox50,
  "internet|mobi|4mb 80gb": cardInternetMobi4Mb80Gb,
  "internet|mobi|4mb 80gb fnq": cardInternetMobi4Mb80GbFnq,
  "internet|mobi|4mb 80gb free night": cardInternetMobi4Mb80GbFnq,
  "internet|mobi|4mb unl": cardInternetMobi4MbUnl,
  "internet|mobi|6mb unl": cardInternetMobi6MbUnl,
  "internet|mobi|8mb unl": cardInternetMobi8MbUnl,
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
  "internet|terranet|army dsl 8mb unl/play": cardInternetTerranetArmyDsl8MbUnlPlay,
  "internet|terranet|army dsl os 120gb": cardInternetTerranetArmyDslOs120Gb,
  "internet|terranet|army dsl os 160gb/4mb unl": cardInternetTerranetArmyDslOs160Gb4MbUnl,
  "internet|terranet|army dsl os 200gb/6mb unl": cardInternetTerranetArmyDslOs200Gb6MbUnl,
  "internet|terranet|army dsl os 240gb": cardInternetTerranetArmyDslOs240Gb,
  "internet|terranet|army dsl os 400gb": cardInternetTerranetArmyDslOs400Gb,
  "internet|terranet|army dsl os 500gb": cardInternetTerranetArmyDslOs500Gb,
  "internet|terranet|dsl extra volume 5gb": cardInternetTerranetDslExtraVolume5Gb,
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
  "internet|wise|11100": cardInternetWise11100,
  "internet|wise|2890": cardInternetWise2890,
  "internet|wise|5780": cardInternetWise5780,
  "internet|wise|8000": cardInternetWise8000,
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
};
