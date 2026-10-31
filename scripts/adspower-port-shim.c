// Gives each agent's AdsPower its own Local API port while it keeps its window (1 Nov 2026).
// In window mode AdsPower ignores --api-port and always takes 50325, so only one copy on the box could have its API.
// Loaded with LD_PRELOAD into one copy (and every process it starts), this moves bind() and connect() on a local
// address with port 50325 to that copy's own port (env AQ_ADSPOWER_PORT). The copy, its helpers and its browsers all
// still think "50325" and find each other; from outside its API is on its own port. Every other port is left alone.
// Built by aqeelOS on the box: cc -shared -fPIC -O2 -o adspower-port-shim.so adspower-port-shim.c -ldl
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdlib.h>
#include <string.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <sys/socket.h>

#define FROM 50325
typedef int (*fn_t)(int,const struct sockaddr*,socklen_t);
static int to_port(void){const char*s=getenv("AQ_ADSPOWER_PORT");int p=s?atoi(s):0;return p>0&&p<65536&&p!=FROM?p:0;}

// any or loopback, IPv4, IPv6 or IPv4-in-IPv6; bind also takes "any", connect only loopback
static int local_addr(const struct sockaddr*a,socklen_t n,int any_ok){
 if(a->sa_family==AF_INET&&n>=sizeof(struct sockaddr_in)){const struct sockaddr_in*v=(const void*)a;uint32_t h=ntohl(v->sin_addr.s_addr);
  return ntohs(v->sin_port)==FROM&&((h>>24)==127||(any_ok&&h==0));}
 if(a->sa_family==AF_INET6&&n>=sizeof(struct sockaddr_in6)){const struct sockaddr_in6*v=(const void*)a;const struct in6_addr*x=&v->sin6_addr;
  if(ntohs(v->sin6_port)!=FROM)return 0;
  if(IN6_IS_ADDR_LOOPBACK(x)||(any_ok&&IN6_IS_ADDR_UNSPECIFIED(x)))return 1;
  if(IN6_IS_ADDR_V4MAPPED(x)){uint32_t h=ntohl(((const uint32_t*)x)[3]);return (h>>24)==127||(any_ok&&h==0);}}
 return 0;}

static int moved(const char*name,int fd,const struct sockaddr*a,socklen_t n,int any_ok){
 static fn_t real_bind,real_connect;fn_t*slot=name[0]=='b'?&real_bind:&real_connect;
 if(!*slot)*slot=(fn_t)dlsym(RTLD_NEXT,name);
 int p=to_port();if(!a||!p||!local_addr(a,n,any_ok))return (*slot)(fd,a,n);
 struct sockaddr_storage c;if(n>sizeof c)return (*slot)(fd,a,n);memcpy(&c,a,n);
 if(a->sa_family==AF_INET)((struct sockaddr_in*)&c)->sin_port=htons(p);else ((struct sockaddr_in6*)&c)->sin6_port=htons(p);
 return (*slot)(fd,(struct sockaddr*)&c,n);}

int bind(int fd,const struct sockaddr*a,socklen_t n){return moved("bind",fd,a,n,1);}
int connect(int fd,const struct sockaddr*a,socklen_t n){return moved("connect",fd,a,n,0);}
