export enum Language {
    ROMANCE = "romance",
    GERMANIC = "germanic",
    SLAVIC = "slavic",
    TURKIC = "turkic",
    SEMITIC = "semitic",
    BANTU_LIKE = "bantu_like",
    AFRICAN_WEST = "african_west",
    AFRICAN_HORN = "african_horn",
    EAST_ASIAN_CN = "east_asian_cn",
    EAST_ASIAN_JP = "east_asian_jp",
    EAST_ASIAN_KR = "east_asian_kr",
    POLYNESIAN = "polynesian",
};

type LanguageConfig = {
    onsets: string[];
    vowels: string[];
    codas: string[];
    codaChance: number;          // likelihood of adding a coda after a vowel
    medials: string[];           // not used yet, but handy for later flavor
    medialMorphChance: number;   // ^
    suffixes: string[]
};

// A few reusable vowel bundles to bias families
const V_OPEN = ["a", "e", "i", "o", "u"];
const V_DIP = ["ai", "au", "ei", "ia", "io", "oa", "ue", "ui"];
const V_SOFT = ["a", "e", "i", "o", "u", "ia", "io", "ie", "ea"];
const V_SEMI = ["a", "i", "u", "aa", "ii", "uu", "ai", "au"];

export const languageConfigs: { [key: string]: LanguageConfig } = {
    [Language.ROMANCE]: {
        onsets: ["b", "c", "d", "f", "g", "l", "m", "n", "p", "r", "s", "t",
            "br", "cr", "dr", "fl", "gl", "gr", "pr", "tr", "vr"],
        vowels: [...V_SOFT, "oa", "ue", "eo"],
        codas: ["n", "r", "s", "l", "m"],
        codaChance: 0.45,
        medials: ["del", "dor", "ver", "mar", "val", "lor", "ria", "lia", "mia"],
        medialMorphChance: 0.35,
        suffixes: ["ia", "aria", "esia"],
    },
    [Language.GERMANIC]: {
        onsets: ["b", "d", "f", "g", "h", "k", "l", "m", "n", "p", "r", "s", "t", "w", "th",
            "br", "cr", "dr", "fr", "gr", "kr", "pr", "tr", "st", "sk", "sp"],
        vowels: [...V_OPEN, ...V_DIP],
        codas: ["nd", "rt", "rm", "rg", "lf", "rk", "lt", "st", "sk", "n", "r", "m", "l", "k"],
        codaChance: 0.65,
        medials: ["wald", "heim", "mark", "gard", "dorf"],
        medialMorphChance: 0.30,
        suffixes: ["land", "heim", "berg"],
    },
    [Language.SLAVIC]: {
        onsets: ["b", "v", "g", "d", "z", "k", "l", "m", "n", "p", "r", "s", "t",
            "br", "cr", "dr", "gr", "kr", "pr", "tr", "vl", "vr", "zv", "zl", "sk", "sp", "sl", "sm", "sn", "pl", "kl", "gl", "brn"],
        vowels: [...V_OPEN, "ya", "yo", "yu", "ia", "ie", "io"],
        codas: ["v", "n", "r", "nsk", "grad", "gor", "pol", "mir", "slav", "sk"],
        codaChance: 0.70,
        medials: ["grad", "slav", "pol", "gor"],
        medialMorphChance: 0.40,
        suffixes: ["ia", "ovia", "grad"],
    },
    [Language.SEMITIC]: {
        onsets: ["al", "ar", "as", "bal", "dar", "qal", "mal", "ram", "sam", "zar", "bar", "sar"],
        vowels: [...V_SEMI],
        codas: ["n", "m", "r", "l", "s", "h"],
        codaChance: 0.50,
        medials: ["har", "sar", "ram", "bar"],
        medialMorphChance: 0.35,
        suffixes: ["ia", "aya", "iyya"],
    },
    [Language.AFRICAN_WEST]: {
        onsets: [
            "a", "ba", "da", "ka", "fa", "ga", "la", "ma", "na", "oba", "ola", "ade",
            "kw", "gb", "ch", "ny", "eke", "oba", "ife", "olu"
        ],
        vowels: ["a", "e", "i", "o", "u", "ai", "oa", "ie", "ua"],
        codas: ["n", "m", "wa", "ra", ""],
        codaChance: 0.35,
        medials: ["loba", "femi", "kwe", "tunde", "chukwu", "nwa", "kofi", "yemi"],
        medialMorphChance: 0.40,
        suffixes: ["la", "ba", "ra", "ni", "do", "ma"],
    },
    [Language.AFRICAN_HORN]: {
        onsets: [
            "ab", "ad", "as", "ba", "da", "ha", "ka", "ma", "na", "sa", "ra", "ta",
            "gez", "tes", "hab", "sel", "mer", "zer", "yon", "lem"
        ],
        vowels: ["a", "e", "i", "o", "u", "aa", "ee", "ei", "ia", "ua"],
        codas: ["s", "m", "n", "l", "t", ""],
        codaChance: 0.45,
        medials: ["sel", "geb", "tek", "yon", "hab", "mar", "zer", "wold"],
        medialMorphChance: 0.35,
        suffixes: ["el", "es", "os", "on", "u"],
    },
    [Language.EAST_ASIAN_CN]: {
        onsets: [
            "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h",
            "zh", "ch", "sh", "r", "z", "c", "s"
        ],
        vowels: [
            "a", "o", "e", "i", "u", "ü",
            "ai", "ei", "ao", "ou", "ia", "ie", "iao", "iu", "ua", "uo", "ui", "üe", "er"
        ],
        codas: ["n", "ng", ""],
        codaChance: 0.40,
        medials: ["shan", "jiang", "he", "hu", "zhou", "dao", "lin", "yang", "qing", "jing", "guo", "cheng"],
        medialMorphChance: 0.30,
        suffixes: ["shan", "dao", "zhou", "guo", "cheng", "men"],
    },

    [Language.EAST_ASIAN_JP]: {
        onsets: [
            "k", "s", "t", "n", "h", "m", "y", "r", "w",
            "g", "z", "d", "b", "p",
            "ky", "sh", "ch", "ny", "hy", "my", "ry", "gy", "j", "py"
        ],
        vowels: ["a", "i", "u", "e", "o"],
        codas: ["", "n"],
        codaChance: 0.35,
        medials: ["mori", "yama", "kawa", "gawa", "shima", "jima", "saka", "hara", "tani"],
        medialMorphChance: 0.30,
        suffixes: ["to", "ken", "do", "fu", "shi", "mura"],
    },

    [Language.EAST_ASIAN_KR]: {
        onsets: [
            "g", "n", "d", "r", "m", "b", "s", "j", "ch", "k", "t", "p", "h"
        ],
        vowels: [
            "a", "eo", "o", "u", "eu", "i",
            "ae", "e", "ya", "yeo", "yo", "yu", "wa", "we", "wi", "ui"
        ],
        codas: ["k", "n", "t", "l", "m", "p", "ng", ""],
        codaChance: 0.45,
        medials: ["san", "seong", "gang", "cheon", "buk", "nam", "jin", "dae", "won", "do"],
        medialMorphChance: 0.35,
        suffixes: ["do", "si", "gun", "eup", "ri"],
    },
    [Language.POLYNESIAN]: {
        // allow vowel-initial names; Polynesian loves CV / V syllables
        onsets: [
            "", "h", "k", "l", "m", "n", "p", "r", "t", "w",
            "wh", "ng" // Māori-style digraphs (keep if you like that flavor)
        ],
        // favor pure vowels & gentle diphthongs; add macrons if allowDiacritics
        vowels: ["a", "e", "i", "o", "u"],
        codas: ["", "’", "ʻ"], // ASCII apostrophe and unicode okina options
        codaChance: 0.2,
        // common morphemes across Māori/Samoan/Tahitian/Hawaiian vibes
        medials: [
            "moa", "rangi", "tonga", "tai", "wai", "puna", "tapu", "mana",
            "ariki", "tiki", "honu", "pua", "mata", "ika", "koro", "hale", "fale", "nui", "loa", "roa"
        ],
        medialMorphChance: 0.30,
        // gentle, place-namey endings
        suffixes: ["nui", "roa", "loa", "rangi", "moana", "tonga", "tai", "puna"],
    },
}