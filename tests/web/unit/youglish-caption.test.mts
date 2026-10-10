import {test,expect} from 'vitest';
import {decodeYouglishCaption} from '../../../apps/web/src/experience/youglishCaption';

test('Widget legacy byte captions decode Spanish accents and retain query markers',()=>{
 expect(decodeYouglishCaption('Espa%F1a%20%5B%5B%5BBorrow%5D%5D%5D')).toBe('España [[[Borrow]]]');
 expect(decodeYouglishCaption('Sigui%F3%20a%20trav%E9s')).toBe('Siguió a través');
});
test('UTF-8 and legacy Unicode escapes decode without losing non-Latin text',()=>{
 expect(decodeYouglishCaption('Espa%C3%B1a')).toBe('España');
 expect(decodeYouglishCaption('%E4%BD%A0%E5%A5%BD')).toBe('你好');
 expect(decodeYouglishCaption('%u4F60%u597D%20%uD83D%uDE00')).toBe('你好 😀');
});
test('caption decoding is one transport layer and preserves literal percentages',()=>{
 expect(decodeYouglishCaption('100% sure%20%E2%80%94%20caf%E9')).toBe('100% sure — café');
 expect(decodeYouglishCaption('literal%20%2520')).toBe('literal %20');
 expect(decodeYouglishCaption('España 100%')).toBe('España 100%');
});
