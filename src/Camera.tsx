import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { PerspectiveCamera } from 'three'
import gsap from 'gsap'
import type { Place } from './content'
import { focusPoseForPlace, focusSubPose, galleryPose, hallPose, makeRoute, stablePose, type CameraPose, type FocusSubPoseId, type TransitionState } from './layout'

export type CameraHandle = { travel: (target: Place, reduced: boolean, commit: () => void) => Promise<void> }
export const CameraController = forwardRef<CameraHandle,{place:Place;busy:boolean;reduced:boolean;galleryIndex:number;galleryCount:number;focusId?:FocusSubPoseId|null;progress:React.MutableRefObject<number>;onTransition:(state:TransitionState|null)=>void}>(({place,busy,reduced,galleryIndex,galleryCount,focusId=null,progress,onTransition},ref)=>{
  const {camera:baseCamera,size}=useThree(),camera=baseCamera as PerspectiveCamera
  const active=useRef(false),focusTween=useRef<gsap.core.Tween|null>(null),smooth=useRef(progress.current),tween=useRef<gsap.core.Tween|null>(null),finishSegment=useRef<(()=>void)|null>(null),reducedRef=useRef(reduced)
  const dimensions=useRef(size),galleryRef=useRef({index:galleryIndex,count:galleryCount}),prevFocus=useRef<FocusSubPoseId|null>(null),placeRef=useRef(place),onTransitionRef=useRef(onTransition)
  dimensions.current=size;reducedRef.current=reduced;galleryRef.current={index:galleryIndex,count:galleryCount};placeRef.current=place;onTransitionRef.current=onTransition
  const apply=(p:CameraPose)=>{camera.position.copy(p.position);camera.quaternion.copy(p.orientation);camera.fov=p.fov;camera.updateProjectionMatrix()}
  const aspect=()=>dimensions.current.width/dimensions.current.height
  const targetPoseForCurrent=(p:Place,focus:FocusSubPoseId|null)=>{
    const validFocus=focusPoseForPlace(focus,p)
    return validFocus?focusSubPose(validFocus,aspect()):stablePose(p,progress.current,aspect(),galleryRef.current.index,galleryRef.current.count)
  }
  useLayoutEffect(()=>{
    if(!active.current&&!focusTween.current){
      apply(targetPoseForCurrent(place,focusId))
    }
  },[place,size.width,size.height])
  useEffect(()=>{
    const validFocus=focusPoseForPlace(focusId,place)
    if(active.current){prevFocus.current=validFocus;return}
    if(prevFocus.current===validFocus){
      if(reduced&&focusTween.current){
        focusTween.current.kill();focusTween.current=null
        apply(targetPoseForCurrent(place,validFocus))
      }
      return
    }
    prevFocus.current=validFocus
    focusTween.current?.kill();focusTween.current=null
    const dest=targetPoseForCurrent(place,validFocus)
    if(reduced||document.hidden){
      apply(dest)
      return
    }
    const start={position:camera.position.clone(),orientation:camera.quaternion.clone(),fov:camera.fov},value={t:0}
    focusTween.current=gsap.to(value,{
      t:1,
      duration:.62,
      ease:'power2.out',
      onUpdate:()=>{
        camera.position.lerpVectors(start.position,dest.position,value.t)
        camera.quaternion.slerpQuaternions(start.orientation,dest.orientation,value.t)
        camera.fov=start.fov+(dest.fov-start.fov)*value.t
        camera.updateProjectionMatrix()
      },
      onComplete:()=>{
        focusTween.current=null
        apply(dest)
      },
    })
  },[focusId,place,reduced])
  useEffect(()=>{if(reduced&&active.current)finishSegment.current?.()},[reduced])
  useEffect(()=>{
    const visibility=()=>{if(document.hidden){finishSegment.current?.();focusTween.current?.kill();focusTween.current=null}}
    document.addEventListener('visibilitychange',visibility)
    return()=>{document.removeEventListener('visibilitychange',visibility);tween.current?.kill();focusTween.current?.kill();finishSegment.current?.()}
  },[])
  useImperativeHandle(ref,()=>({travel:async(target,quiet,commit)=>{
    focusTween.current?.kill();focusTween.current=null;prevFocus.current=null
    active.current=true
    const from=placeRef.current,points=makeRoute(from,target,progress.current,aspect(),galleryRef.current.index,galleryRef.current.count)
    try{
      for(let i=0;i<points.length;i++){
        const point=points[i]
        onTransitionRef.current({from,to:target,phase:point.phase,progress:i/points.length})
        if(quiet||reducedRef.current||document.hidden){apply(point.pose);continue}
        const start={position:camera.position.clone(),orientation:camera.quaternion.clone(),fov:camera.fov},value={t:0}
        await new Promise<void>(resolve=>{
          let ended=false
          const finish=()=>{if(ended)return;ended=true;clearTimeout(timer);tween.current?.kill();apply(point.pose);finishSegment.current=null;resolve()}
          const timer=setTimeout(finish,point.duration*1000+300)
          finishSegment.current=finish
          tween.current=gsap.to(value,{t:1,duration:point.duration,ease:'power2.inOut',onUpdate:()=>{
            camera.position.lerpVectors(start.position,point.pose.position,value.t)
            camera.quaternion.slerpQuaternions(start.orientation,point.pose.orientation,value.t)
            camera.fov=start.fov+(point.pose.fov-start.fov)*value.t;camera.updateProjectionMatrix()
            onTransitionRef.current({from,to:target,phase:point.phase,progress:(i+value.t)/points.length})
          },onComplete:finish})
        })
      }
      // Resize, reduced motion and background recovery share one deterministic endpoint.
      apply(stablePose(target,progress.current,aspect(),galleryRef.current.index,galleryRef.current.count));smooth.current=progress.current
      onTransitionRef.current({from,to:target,phase:'complete',progress:1});commit()
    }finally{active.current=false;onTransitionRef.current(null)}
  }}),[])
  useFrame((_,dt)=>{
    if(!active.current&&!busy&&place==='hall'){
      smooth.current=reduced?progress.current:smooth.current+(progress.current-smooth.current)*(1-Math.exp(-Math.min(dt,.1)*9))
      apply(hallPose(smooth.current,aspect()))
    }
    if(!active.current&&!busy&&place==='gallery'&&aspect()<=.8){
      const target=galleryPose(galleryIndex,galleryCount),alpha=reduced?1:1-Math.exp(-Math.min(dt,.1)*12)
      camera.position.lerp(target.position,alpha);camera.quaternion.slerp(target.orientation,alpha)
      camera.fov=target.fov;camera.updateProjectionMatrix()
    }
  })
  return null
})
