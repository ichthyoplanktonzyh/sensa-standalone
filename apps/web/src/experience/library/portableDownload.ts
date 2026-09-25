import type {PortablePackageExport} from '../../contentSupply/system';

export function downloadPortablePackage(result:PortablePackageExport):void{
  const url=URL.createObjectURL(new Blob([result.bytes.slice().buffer],{
    type:'application/vnd.sensa.package+zip',
  }));
  const anchor=document.createElement('a');
  anchor.href=url;
  anchor.download=result.fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
