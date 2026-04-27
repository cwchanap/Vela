import kuromoji from 'kuromoji';

export interface Token {
  surface_form: string;
  reading: string;
  dictionary_form: string;
  pos: string;
  pos_detail_1: string;
}

let _dicPath = '/kuromoji-dict';
let tokenizerPromise: Promise<kuromoji.Tokenizer<kuromoji.IpadicFeatures>> | null = null;

/**
 * Set the kuromoji dictionary path before the first tokenize() call.
 * Default: '/kuromoji-dict' (assumes dict files served at that URL path).
 */
export function configureDicPath(dicPath: string): void {
  _dicPath = dicPath;
}

export async function tokenize(text: string): Promise<Token[]> {
  if (!tokenizerPromise) {
    tokenizerPromise = new Promise<kuromoji.Tokenizer<kuromoji.IpadicFeatures>>(
      (resolve, reject) => {
        kuromoji.builder({ dicPath: _dicPath }).build((err, tokenizer) => {
          if (err) {
            reject(err);
            return;
          }

          resolve(tokenizer);
        });
      },
    ).catch((error) => {
      tokenizerPromise = null;
      throw error;
    });
  }
  const tokenizer = await tokenizerPromise;
  return tokenizer
    .tokenize(text)
    .filter((t) => t.surface_form.trim() !== '')
    .map((t) => ({
      surface_form: t.surface_form,
      reading: t.reading && t.reading !== '*' ? t.reading : t.surface_form,
      dictionary_form: t.basic_form && t.basic_form !== '*' ? t.basic_form : t.surface_form,
      pos: t.pos,
      pos_detail_1: t.pos_detail_1 ?? '',
    }));
}
